-- 0003 WhatsApp notification: the customer is told when a job is Job Done.
-- Builds on 0000-0002; nothing here edits an earlier file.
--
-- * customer_messages: one row per Job Done (a rework resubmission reaches
--   Job Done again and gets a new row). The row holds the customer's number,
--   the channel (`whatsapp` for a mobile, `phone` for a landline), the text the
--   database prepared (`prepared_body`, never changes), the text that will be
--   sent (`body`, editable until confirmed) and the state: `not_sent`, `sent`
--   or `told_by_phone`, with who confirmed it and when. Rows are never deleted
--   and a confirmed row never changes again.
-- * An after-update-of-status trigger on orders writes the row in the same
--   transaction as submit_completion (the only way to reach Job Done). The
--   wording lives in _customer_job_done_message(); times are Malaysia time in
--   the app's format (`Thu 22 Oct 2026, 3:15 PM`, _malaysia_date_time).
-- * edit_customer_message / confirm_customer_message: the assigned technician
--   or an Admin edits the text before sending, then confirms "Yes, I sent it"
--   (WhatsApp) or "Yes, I told them by phone" (landline) while the order is
--   Job Done, Reviewed or Closed. Only the latest message of an order can be
--   edited or confirmed; the first confirmation wins and there is no undo.
--   Both write an audit entry (customer_message_edited, customer_messaged,
--   customer_called).
-- * latest_customer_messages: the newest message per order with the editor's
--   and confirmer's names (security_invoker, so the policies below apply).
-- * Orders already Job Done, Reviewed or Closed get a `not_sent` message, using
--   the completion's time and technician.
--
-- src/domain/customerMessages.ts and phone.ts mirror the rules;
-- tests/db/parity.test.ts keeps both identical.

-- ---------------------------------------------------------------------------
-- Rules
-- ---------------------------------------------------------------------------
-- A stored Malaysian mobile number (WhatsApp-capable): 601 + 8 or 9 digits.
create function _is_my_mobile(p_phone text) returns boolean
language sql immutable as $$
  select coalesce(p_phone ~ '^601[0-9]{8,9}$', false);
$$;

-- `Thu 22 Oct 2026, 3:15 PM` in Malaysia time (Asia/Kuala_Lumpur, UTC+8, no
-- daylight saving); '' for null. Same text as formatMalaysiaDateTime.
create function _malaysia_date_time(p_at timestamptz) returns text
language sql stable as $$
  select coalesce(
    to_char(p_at at time zone 'Asia/Kuala_Lumpur', 'Dy FMDD Mon YYYY, FMHH12:MI AM'),
    '');
$$;

-- The customer message for a finished job, in English (the brief's wording).
-- 0008 adds the feedback link here.
create function _customer_job_done_message(
  p_customer_name   text,
  p_order_no        text,
  p_technician_name text,
  p_completed_at    timestamptz
) returns text
language sql stable as $$
  select format(
    'Hi %s, Job %s has been completed by Technician %s at %s. Please check and leave feedback. Thank you!',
    p_customer_name, p_order_no, p_technician_name, _malaysia_date_time(p_completed_at));
$$;

-- The text that will be sent: trimmed (spaces, tabs and line breaks at both
-- ends), 1 to 1,000 characters (counted as characters, so an emoji is one).
create function _check_customer_message_body(p_body text) returns text
language plpgsql immutable as $$
declare
  v_body text := btrim(coalesce(p_body, ''), E' \t\r\n\f\v');
begin
  if v_body = '' then
    raise exception 'Enter the message to send';
  end if;
  if char_length(v_body) > 1000 then
    raise exception 'The message can be at most 1,000 characters';
  end if;
  return v_body;
end;
$$;

-- ---------------------------------------------------------------------------
-- customer_messages
-- ---------------------------------------------------------------------------
create table customer_messages (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references orders (id) on delete cascade,
  channel       text not null,
  phone         text not null,
  prepared_body text not null check (btrim(prepared_body) <> ''),
  body          text not null check (btrim(body) <> ''),
  edited_by     uuid references staff (id),
  edited_at     timestamptz,
  status        text not null default 'not_sent',
  confirmed_by  uuid references staff (id),
  confirmed_at  timestamptz,
  created_at    timestamptz not null default now(),
  constraint customer_messages_channel_check check (channel in ('whatsapp', 'phone')),
  constraint customer_messages_status_check check (status in ('not_sent', 'sent', 'told_by_phone')),
  -- WhatsApp only for a mobile number; a landline is called instead.
  constraint customer_messages_channel_phone_check check ((channel = 'whatsapp') = _is_my_mobile(phone)),
  -- Sent over WhatsApp, or told by phone: each status belongs to one channel.
  constraint customer_messages_status_channel_check check (
    status = 'not_sent'
    or (status = 'sent' and channel = 'whatsapp')
    or (status = 'told_by_phone' and channel = 'phone')),
  -- Who and when are filled in exactly when the message is no longer not_sent.
  constraint customer_messages_confirmed_check check (
    (status = 'not_sent' and confirmed_by is null and confirmed_at is null)
    or (status <> 'not_sent' and confirmed_by is not null and confirmed_at is not null)),
  constraint customer_messages_edited_check check ((edited_by is null) = (edited_at is null))
);

create index customer_messages_order_idx on customer_messages (order_id, created_at desc, id desc);

-- Rows are never deleted. Only the text (until confirmed) and the confirmation
-- can change, once; a confirmed row never changes again.
create function customer_messages_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Customer messages cannot be deleted';
  end if;
  if old.status <> 'not_sent' then
    raise exception 'A confirmed customer message cannot be changed';
  end if;
  if new.id is distinct from old.id
     or new.order_id is distinct from old.order_id
     or new.channel is distinct from old.channel
     or new.phone is distinct from old.phone
     or new.prepared_body is distinct from old.prepared_body
     or new.created_at is distinct from old.created_at then
    raise exception 'Only the text and the confirmation of a customer message can change';
  end if;
  return new;
end;
$$;

create trigger customer_messages_guard_trg
  before update or delete on customer_messages
  for each row execute function customer_messages_guard();

-- ---------------------------------------------------------------------------
-- Job Done trigger: prepare the customer message
-- ---------------------------------------------------------------------------
-- Fires when an order reaches Job Done from any other status (submit_completion
-- first, and again after a rework). Reads the completion record for the time
-- and the technician; if there is none it falls back to now() and the
-- assigned technician so no Job Done is left without a message.
create function orders_customer_message() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_completion order_completions;
  v_name       text;
  v_body       text;
begin
  select * into v_completion from order_completions where order_id = new.id;
  select name into v_name
    from staff
   where id = coalesce(v_completion.technician_id, new.assigned_technician_id);

  v_body := _customer_job_done_message(
    new.customer_name, new.order_no, v_name, coalesce(v_completion.completed_at, now()));

  insert into customer_messages (order_id, channel, phone, prepared_body, body)
  values (new.id,
          case when _is_my_mobile(new.customer_phone) then 'whatsapp' else 'phone' end,
          new.customer_phone, v_body, v_body);
  return new;
end;
$$;

create trigger orders_customer_message_trg
  after update of status on orders
  for each row
  when (new.status = 'job_done' and old.status is distinct from 'job_done')
  execute function orders_customer_message();

-- ---------------------------------------------------------------------------
-- Existing orders: one not_sent message for every order already Job Done,
-- Reviewed or Closed that has a completion record.
-- ---------------------------------------------------------------------------
insert into customer_messages (order_id, channel, phone, prepared_body, body)
select o.id,
       case when _is_my_mobile(o.customer_phone) then 'whatsapp' else 'phone' end,
       o.customer_phone,
       m.body,
       m.body
  from orders o
  join order_completions c on c.order_id = o.id
  join staff t on t.id = c.technician_id
 cross join lateral (
   select _customer_job_done_message(o.customer_name, o.order_no, t.name, c.completed_at) as body
 ) m
 where o.status in ('job_done', 'reviewed', 'closed')
   and not exists (select 1 from customer_messages x where x.order_id = o.id);

-- ---------------------------------------------------------------------------
-- Shared checks for edit and confirm
-- ---------------------------------------------------------------------------
-- "Already sent by Ali at Thu 22 Oct 2026, 3:20 PM" for a confirmed message.
create function _customer_message_confirmed_error(p_msg customer_messages) returns text
language sql stable as $$
  select format('Already %s by %s at %s',
    case p_msg.status when 'told_by_phone' then 'told by phone' else 'sent' end,
    coalesce((select name from staff where id = p_msg.confirmed_by), 'someone'),
    _malaysia_date_time(p_msg.confirmed_at));
$$;

-- Who may edit or confirm, and when. Null = allowed, else the message.
-- p_verb reads in the messages: 'edited' or 'confirmed'.
create function _customer_message_error(
  p_actor staff,
  p_order orders,
  p_msg   customer_messages,
  p_verb  text
) returns text
language plpgsql stable as $$
begin
  if not (
    p_actor.role = 'admin'
    or (p_actor.role = 'technician' and p_order.assigned_technician_id = p_actor.id)
  ) then
    return 'Only the assigned technician or an Admin can change the customer message of an order';
  end if;
  if p_order.status not in ('job_done', 'reviewed', 'closed') then
    return format('A customer message can only be %s while the order is Job Done, Reviewed or Closed (it is currently %s)',
      p_verb, _status_label(p_order.status));
  end if;
  if exists (
    select 1 from customer_messages n
     where n.order_id = p_msg.order_id
       and (n.created_at, n.id) > (p_msg.created_at, p_msg.id)
  ) then
    return 'A newer message has been prepared for this order. Reload the page to see it.';
  end if;
  if p_msg.status <> 'not_sent' then
    return _customer_message_confirmed_error(p_msg);
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- edit_customer_message: change the text before it is sent
-- ---------------------------------------------------------------------------
create function edit_customer_message(p_message_id uuid, p_body text) returns customer_messages
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor    staff := _require_actor();
  v_msg      customer_messages;
  v_order    orders;
  v_error    text;
  v_body     text;
  v_previous text;
begin
  select * into v_msg from customer_messages where id = p_message_id;
  if not found then
    raise exception 'Message not found';
  end if;
  v_order := _lock_order(v_msg.order_id);
  -- Re-read under the order lock (the other person may have confirmed meanwhile).
  select * into v_msg from customer_messages where id = p_message_id;

  v_error := _customer_message_error(v_actor, v_order, v_msg, 'edited');
  if v_error is not null then
    raise exception '%', v_error;
  end if;
  if v_msg.channel <> 'whatsapp' then
    raise exception 'Only a WhatsApp message can be edited (this customer has no WhatsApp number)';
  end if;
  v_body := _check_customer_message_body(p_body);

  v_previous := v_msg.body;
  update customer_messages
     set body = v_body,
         edited_by = v_actor.id,
         edited_at = now()
   where id = v_msg.id
   returning * into v_msg;

  perform _audit(v_order.id, v_actor, 'customer_message_edited', null, null, null,
    jsonb_build_object(
      'message_id', v_msg.id,
      'previous_body', v_previous,
      'new_body', v_msg.body,
      'status', v_order.status));

  return v_msg;
end;
$$;

-- ---------------------------------------------------------------------------
-- confirm_customer_message: "Yes, I sent it" / "Yes, I told them by phone"
-- ---------------------------------------------------------------------------
-- The first confirmation wins: a second one (the other person got there first)
-- fails with "Already sent by X at T". There is no undo.
create function confirm_customer_message(p_message_id uuid) returns customer_messages
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor staff := _require_actor();
  v_msg   customer_messages;
  v_order orders;
  v_error text;
begin
  select * into v_msg from customer_messages where id = p_message_id;
  if not found then
    raise exception 'Message not found';
  end if;
  v_order := _lock_order(v_msg.order_id);
  -- Re-read under the order lock: this is where the second confirmer is stopped.
  select * into v_msg from customer_messages where id = p_message_id;

  v_error := _customer_message_error(v_actor, v_order, v_msg, 'confirmed');
  if v_error is not null then
    raise exception '%', v_error;
  end if;

  update customer_messages
     set status = case v_msg.channel when 'whatsapp' then 'sent' else 'told_by_phone' end,
         confirmed_by = v_actor.id,
         confirmed_at = now()
   where id = v_msg.id
   returning * into v_msg;

  perform _audit(v_order.id, v_actor,
    case v_msg.channel when 'whatsapp' then 'customer_messaged' else 'customer_called' end,
    null, null, null,
    jsonb_build_object(
      'message_id', v_msg.id,
      'channel', v_msg.channel,
      'phone', v_msg.phone,
      'body', v_msg.body,
      'edited', v_msg.edited_at is not null,
      'status', v_order.status));

  return v_msg;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reads: row-level security and the latest-message view
-- ---------------------------------------------------------------------------
alter table customer_messages enable row level security;

-- The assigned technician and Admins (Manager / Finance access comes with 0007).
create policy customer_messages_read on customer_messages
  for select to authenticated
  using (
    _current_staff_role() = 'admin'
    or (
      _current_staff_role() = 'technician'
      and exists (
        select 1 from orders o
         where o.id = customer_messages.order_id
           and o.assigned_technician_id = _current_staff_id())
    )
  );

-- The newest message of each order, with the editor's and confirmer's names.
-- security_invoker: the policy above applies through the view.
create view latest_customer_messages with (security_invoker = true) as
select distinct on (m.order_id)
  m.id,
  m.order_id,
  m.channel,
  m.phone,
  m.prepared_body,
  m.body,
  m.status,
  m.edited_by,
  e.name as edited_by_name,
  m.edited_at,
  m.confirmed_by,
  c.name as confirmed_by_name,
  m.confirmed_at,
  m.created_at
from customer_messages m
left join staff e on e.id = m.edited_by
left join staff c on c.id = m.confirmed_by
order by m.order_id, m.created_at desc, m.id desc;

-- ---------------------------------------------------------------------------
-- Privileges: read-only tables and view for signed-in staff (RLS narrows the
-- rows); the two RPCs for signed-in staff; helpers and triggers internal.
-- ---------------------------------------------------------------------------
revoke all on customer_messages, latest_customer_messages from public, anon, authenticated, service_role;
grant select on customer_messages, latest_customer_messages to authenticated;

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind = 'f'
       and p.proname in (
         '_is_my_mobile', '_malaysia_date_time', '_customer_job_done_message',
         '_check_customer_message_body', '_customer_message_confirmed_error',
         '_customer_message_error', 'customer_messages_guard', 'orders_customer_message',
         'edit_customer_message', 'confirm_customer_message')
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', r.sig);
    if r.proname in ('edit_customer_message', 'confirm_customer_message') then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;
