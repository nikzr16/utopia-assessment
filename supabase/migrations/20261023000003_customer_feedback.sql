-- 0005 Customer feedback (docs/prd/0005-customer-feedback-prd.md,
-- docs/plan/0005-customer-feedback-plan.md).
--
-- * Every WhatsApp Job Done message gets a random feedback token (22 URL-safe
--   characters from a random UUID). Landline messages get none. The token
--   never changes. The text that is sent is the editable `body` plus a fixed
--   last line `Leave feedback: <address>/f/<token>`
--   (_customer_message_full_text); editing the message cannot remove it.
-- * app_settings.feedback_link_base is the link's public address: the local
--   app until 0010 production-deployment (decision 0012). Missing → a
--   placeholder address the screen warns about.
-- * customer_feedback: one row per visit (message): 1-5 stars, "working well"
--   Yes / No, optional comment, taken by link or by phone. The order's
--   technician and branch are copied for the KPI dashboard (0007). Rows never
--   change and are never deleted.
-- * Signed-out visitors (anon) may call exactly two functions:
--   feedback_form(token) and submit_feedback(token, ...). A link is open while
--   its message is the order's latest, the order is Job Done / Reviewed /
--   Closed, it is under 7 days old, and it has no feedback yet.
-- * record_phone_feedback: an Admin or a covering Manager records the rating
--   of a landline customer told by phone; never the technician. Audited.
-- * A rating of 1-2 stars or "not working well" notifies every Manager
--   covering the branch (event low_feedback).
-- * order_feedback (view) for the staff screens; order_review_summary gains
--   the latest rating for the Manager's Reviewed tab.
--
-- src/domain/feedback.ts mirrors the rules; tests/db/parity.test.ts keeps both
-- identical.

-- ---------------------------------------------------------------------------
-- Settings
-- ---------------------------------------------------------------------------
create table app_settings (
  key   text primary key,
  value text not null
);

-- The local app until 0010 sets the deployed address (decision 0012).
insert into app_settings (key, value) values ('feedback_link_base', 'http://localhost:5173');

-- ---------------------------------------------------------------------------
-- Feedback tokens on customer messages
-- ---------------------------------------------------------------------------
-- 16 random bytes (a random UUID: 122 random bits) as 22 URL-safe characters.
create function _new_feedback_token() returns text
language sql volatile as $$
  select translate(
    rtrim(encode(decode(replace(gen_random_uuid()::text, '-', ''), 'hex'), 'base64'), '='),
    '+/', '-_');
$$;

alter table customer_messages add column feedback_token text;
alter table customer_messages add constraint customer_messages_feedback_token_key unique (feedback_token);
alter table customer_messages add constraint customer_messages_feedback_token_check check (
  feedback_token is null
  or (channel = 'whatsapp' and feedback_token ~ '^[A-Za-z0-9_-]{22}$'));

-- Messages from before 0005: a WhatsApp message not sent yet gets its link;
-- a sent one keeps the text it was sent with (no link).
update customer_messages
   set feedback_token = _new_feedback_token()
 where channel = 'whatsapp' and status = 'not_sent';

-- Same as 0003, plus: the feedback token never changes.
create or replace function customer_messages_guard() returns trigger
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
     or new.feedback_token is distinct from old.feedback_token
     or new.created_at is distinct from old.created_at then
    raise exception 'Only the text and the confirmation of a customer message can change';
  end if;
  return new;
end;
$$;

-- Job Done trigger (same as 0003): a WhatsApp message also gets its token.
create or replace function orders_customer_message() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_completion order_completions;
  v_name       text;
  v_body       text;
  v_whatsapp   boolean := _is_my_mobile(new.customer_phone);
begin
  select * into v_completion from order_completions where order_id = new.id;
  select name into v_name
    from staff
   where id = coalesce(v_completion.technician_id, new.assigned_technician_id);

  v_body := _customer_job_done_message(
    new.customer_name, new.order_no, v_name, coalesce(v_completion.completed_at, now()));

  insert into customer_messages (order_id, channel, phone, prepared_body, body, feedback_token)
  values (new.id,
          case when v_whatsapp then 'whatsapp' else 'phone' end,
          new.customer_phone, v_body, v_body,
          case when v_whatsapp then _new_feedback_token() end);
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- The link and the text that is sent
-- ---------------------------------------------------------------------------
-- Used when the address is not set; the panel warns about it.
create function _feedback_link_placeholder() returns text
language sql immutable as $$
  select 'https://feedback-address-not-set.invalid';
$$;

-- `<address>/f/<token>`; null without a token (landline).
create function _feedback_link(p_token text) returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case when p_token is null then null else
    coalesce(
      (select nullif(rtrim(btrim(value), '/'), '') from app_settings where key = 'feedback_link_base'),
      _feedback_link_placeholder())
    || '/f/' || p_token
  end;
$$;

-- The text that is sent: the message, a blank line, and the link line.
create function _customer_message_full_text(p_body text, p_token text) returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case when p_token is null then p_body
              else p_body || E'\n\nLeave feedback: ' || _feedback_link(p_token) end;
$$;

-- confirm_customer_message (same signature as 0004): the audit entry records
-- the full text that was sent, link included.
create or replace function confirm_customer_message(p_message_id uuid) returns customer_messages
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor      staff := _require_actor();
  v_msg        customer_messages;
  v_order      orders;
  v_error      text;
  v_on_behalf  boolean;
  v_completion order_completions;
  v_body       text;
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

  v_on_behalf := v_actor.role = 'manager' and v_msg.channel = 'whatsapp';
  v_body := v_msg.body;
  if v_on_behalf then
    select * into v_completion from order_completions where order_id = v_order.id;
    v_body := _customer_on_behalf_message(
      v_order.customer_name,
      v_order.order_no,
      v_actor.name,
      (select name from branches where id = v_order.branch_id),
      (select name from staff where id = coalesce(v_completion.technician_id, v_order.assigned_technician_id)),
      coalesce(v_completion.completed_at, v_msg.created_at));
  end if;

  update customer_messages
     set status = case v_msg.channel when 'whatsapp' then 'sent' else 'told_by_phone' end,
         body = v_body,
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
      'body', _customer_message_full_text(v_msg.body, v_msg.feedback_token),
      'edited', v_msg.edited_at is not null,
      'on_behalf', v_on_behalf,
      'status', v_order.status));

  return v_msg;
end;
$$;

-- The newest message of each order (same columns as 0003), plus the link and
-- the full text that is (or was) sent.
create or replace view latest_customer_messages with (security_invoker = true) as
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
  m.created_at,
  _feedback_link(m.feedback_token) as feedback_url,
  _customer_message_full_text(m.body, m.feedback_token) as full_body
from customer_messages m
left join staff e on e.id = m.edited_by
left join staff c on c.id = m.confirmed_by
order by m.order_id, m.created_at desc, m.id desc;

-- ---------------------------------------------------------------------------
-- customer_feedback
-- ---------------------------------------------------------------------------
create table customer_feedback (
  id            uuid primary key default gen_random_uuid(),
  message_id    uuid not null references customer_messages (id) on delete cascade,
  order_id      uuid not null references orders (id) on delete cascade,
  technician_id uuid references staff (id),
  branch_id     uuid not null references branches (id),
  rating        smallint not null,
  working_well  boolean not null,
  comment       text,
  source        text not null,
  recorded_by   uuid references staff (id),
  created_at    timestamptz not null default now(),
  -- One feedback per visit.
  constraint customer_feedback_message_key unique (message_id),
  constraint customer_feedback_rating_check check (rating between 1 and 5),
  constraint customer_feedback_comment_check check (
    comment is null or (btrim(comment) <> '' and char_length(comment) <= 1000)),
  constraint customer_feedback_source_check check (source in ('link', 'phone')),
  -- A rating taken by phone names who recorded it; one from the link nobody.
  constraint customer_feedback_recorded_check check ((source = 'phone') = (recorded_by is not null))
);

create index customer_feedback_order_idx on customer_feedback (order_id, created_at desc);
create index customer_feedback_technician_idx on customer_feedback (technician_id, created_at);

-- Feedback is a record of what the customer said: never changed or deleted.
create function customer_feedback_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Customer feedback cannot be deleted';
  end if;
  raise exception 'Customer feedback cannot be changed';
end;
$$;

create trigger customer_feedback_guard_trg
  before update or delete on customer_feedback
  for each row execute function customer_feedback_guard();

-- ---------------------------------------------------------------------------
-- Rules
-- ---------------------------------------------------------------------------
-- A poor rating: 1-2 stars, or the aircon is not working well.
create function _is_low_feedback(p_rating integer, p_working_well boolean) returns boolean
language sql immutable as $$
  select p_rating <= 2 or not p_working_well;
$$;

-- The answers: 1-5 stars and Yes / No are required; the comment is optional,
-- trimmed, at most 1,000 characters. Returns the comment to store (or null).
create function _check_feedback(p_rating integer, p_working_well boolean, p_comment text) returns text
language plpgsql immutable as $$
declare
  v_comment text := nullif(btrim(coalesce(p_comment, ''), E' \t\r\n\f\v'), '');
begin
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'Choose a rating from 1 to 5 stars';
  end if;
  if p_working_well is null then
    raise exception 'Tell us whether your aircon is working well now';
  end if;
  if char_length(v_comment) > 1000 then
    raise exception 'The comment can be at most 1,000 characters';
  end if;
  return v_comment;
end;
$$;

-- Where a link stands: open, submitted, replaced (a newer visit, or the job
-- is being reworked), expired (7 days after Job Done), or not_found.
create function _feedback_link_state(p_msg customer_messages, p_order orders) returns text
language plpgsql stable as $$
begin
  if p_msg.id is null or p_msg.feedback_token is null or p_order.id is null then
    return 'not_found';
  end if;
  if exists (select 1 from customer_feedback f where f.message_id = p_msg.id) then
    return 'submitted';
  end if;
  if p_order.status not in ('job_done', 'reviewed', 'closed') or exists (
       select 1 from customer_messages n
        where n.order_id = p_msg.order_id
          and (n.created_at, n.id) > (p_msg.created_at, p_msg.id)) then
    return 'replaced';
  end if;
  if now() >= p_msg.created_at + interval '7 days' then
    return 'expired';
  end if;
  return 'open';
end;
$$;

-- What the customer page says for a link that cannot be used.
create function _feedback_state_error(p_state text) returns text
language sql immutable as $$
  select case p_state
    when 'submitted' then 'Thank you, we have already received your feedback for this job'
    when 'replaced'  then 'This feedback link is no longer active. We will send you a new link when the job is done'
    when 'expired'   then 'This feedback link has expired (links work for 7 days after the job is done)'
    else 'This feedback link is not valid. Check that you opened the full link from our message'
  end;
$$;

-- Tell every Manager covering the branch about a poor rating (not the person
-- who recorded it).
create function _notify_low_feedback(p_order orders, p_feedback customer_feedback, p_except uuid) returns void
language plpgsql as $$
declare
  v_manager record;
begin
  if not _is_low_feedback(p_feedback.rating, p_feedback.working_well) then
    return;
  end if;
  for v_manager in
    select s.id from staff s
     where s.role = 'manager'
       and s.active
       and (s.branch_id = p_order.branch_id or p_order.branch_id = any (s.additional_branch_ids))
       and s.id is distinct from p_except
  loop
    perform _notify(v_manager.id, p_order.id, 'low_feedback',
      format('%s: the customer rated %s/5%s', p_order.order_no, p_feedback.rating,
        case when p_feedback.working_well then '' else ' and says the aircon is not working well' end));
  end loop;
end;
$$;

alter table notifications drop constraint notifications_event_check;
alter table notifications add constraint notifications_event_check
  check (event in ('assigned', 'job_done', 'rework', 'reviewed', 'order_updated',
                   'cancelled', 'reassigned_away', 'payment_recorded',
                   'job_approved', 'job_closed', 'low_feedback'));

-- ---------------------------------------------------------------------------
-- The customer page (signed out)
-- ---------------------------------------------------------------------------
-- The link's state and, while open or submitted, only what identifies the
-- job: order number, service type, technician, Job Done time. Never the
-- customer's name, phone, address, or any amount.
create function feedback_form(p_token text)
returns table (
  state           text,
  order_no        text,
  service_type    text,
  technician_name text,
  job_done_at     timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_msg   customer_messages;
  v_order orders;
  v_state text;
begin
  if p_token ~ '^[A-Za-z0-9_-]{22}$' then
    select * into v_msg from customer_messages where feedback_token = p_token;
    select * into v_order from orders where id = v_msg.order_id;
  end if;
  v_state := _feedback_link_state(v_msg, v_order);
  if v_state not in ('open', 'submitted') then
    return query select v_state, null::text, null::text, null::text, null::timestamptz;
    return;
  end if;
  return query
    select v_state,
           v_order.order_no,
           (select st.name from service_types st where st.id = v_order.service_type_id),
           (select s.name from staff s
             where s.id = coalesce(
               (select c.technician_id from order_completions c where c.order_id = v_order.id),
               v_order.assigned_technician_id)),
           v_msg.created_at;
end;
$$;

-- Store the customer's answers once. Any link that is not open is rejected
-- with the page's message; two taps at once store one row (order lock).
create function submit_feedback(
  p_token        text,
  p_rating       integer,
  p_working_well boolean,
  p_comment      text default null
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_msg      customer_messages;
  v_order    orders;
  v_state    text;
  v_comment  text;
  v_feedback customer_feedback;
begin
  if p_token ~ '^[A-Za-z0-9_-]{22}$' then
    select * into v_msg from customer_messages where feedback_token = p_token;
  end if;
  if v_msg.id is null then
    raise exception '%', _feedback_state_error('not_found');
  end if;
  v_order := _lock_order(v_msg.order_id);
  v_state := _feedback_link_state(v_msg, v_order);
  if v_state <> 'open' then
    raise exception '%', _feedback_state_error(v_state);
  end if;
  v_comment := _check_feedback(p_rating, p_working_well, p_comment);

  insert into customer_feedback
    (message_id, order_id, technician_id, branch_id, rating, working_well, comment, source)
  values (v_msg.id, v_order.id,
          coalesce((select c.technician_id from order_completions c where c.order_id = v_order.id),
                   v_order.assigned_technician_id),
          v_order.branch_id, p_rating, p_working_well, v_comment, 'link')
  returning * into v_feedback;

  perform _notify_low_feedback(v_order, v_feedback, null);
  return 'submitted';
end;
$$;

-- ---------------------------------------------------------------------------
-- record_phone_feedback: a landline customer's rating, taken on the call
-- ---------------------------------------------------------------------------
-- Who may record it, and when. Null = allowed, else the message.
create function _phone_feedback_error(p_actor staff, p_order orders, p_msg customer_messages) returns text
language plpgsql stable as $$
declare
  v_existing customer_feedback;
begin
  if not (p_actor.role = 'admin'
          or (p_actor.role = 'manager' and _covers_branch(p_actor, p_order.branch_id))) then
    return format('Only an Admin or a Manager of %s can record a rating taken by phone',
      (select name from branches where id = p_order.branch_id));
  end if;
  if p_msg.channel <> 'phone' then
    return 'This customer has WhatsApp and rates the job with their feedback link';
  end if;
  if p_order.status not in ('job_done', 'reviewed', 'closed') then
    return format('A rating can only be recorded while the order is Job Done, Reviewed or Closed (it is currently %s)',
      _status_label(p_order.status));
  end if;
  if exists (
    select 1 from customer_messages n
     where n.order_id = p_msg.order_id
       and (n.created_at, n.id) > (p_msg.created_at, p_msg.id)
  ) then
    return 'A newer visit has been prepared for this order. Reload the page to see it.';
  end if;
  select * into v_existing from customer_feedback where message_id = p_msg.id;
  if found then
    return format('Already rated %s/5, %s at %s', v_existing.rating,
      case v_existing.source
        when 'phone' then 'taken by phone by ' || coalesce((select name from staff where id = v_existing.recorded_by), 'someone')
        else 'received from the customer' end,
      _malaysia_date_time(v_existing.created_at));
  end if;
  if p_msg.status <> 'told_by_phone' then
    return 'Call the customer and mark them "Told by phone" before recording their rating';
  end if;
  return null;
end;
$$;

create function record_phone_feedback(
  p_message_id   uuid,
  p_rating       integer,
  p_working_well boolean,
  p_comment      text default null
) returns customer_feedback
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor    staff := _require_actor();
  v_msg      customer_messages;
  v_order    orders;
  v_error    text;
  v_comment  text;
  v_feedback customer_feedback;
begin
  select * into v_msg from customer_messages where id = p_message_id;
  if not found then
    raise exception 'Message not found';
  end if;
  v_order := _lock_order(v_msg.order_id);

  v_error := _phone_feedback_error(v_actor, v_order, v_msg);
  if v_error is not null then
    raise exception '%', v_error;
  end if;
  v_comment := _check_feedback(p_rating, p_working_well, p_comment);

  insert into customer_feedback
    (message_id, order_id, technician_id, branch_id, rating, working_well, comment, source, recorded_by)
  values (v_msg.id, v_order.id,
          coalesce((select c.technician_id from order_completions c where c.order_id = v_order.id),
                   v_order.assigned_technician_id),
          v_order.branch_id, p_rating, p_working_well, v_comment, 'phone', v_actor.id)
  returning * into v_feedback;

  perform _audit(v_order.id, v_actor, 'feedback_recorded', null, null, null,
    jsonb_build_object(
      'feedback_id', v_feedback.id,
      'message_id', v_msg.id,
      'rating', v_feedback.rating,
      'working_well', v_feedback.working_well,
      'comment', v_feedback.comment,
      'status', v_order.status));

  perform _notify_low_feedback(v_order, v_feedback, v_actor.id);
  return v_feedback;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------
alter table app_settings enable row level security;
alter table customer_feedback enable row level security;

-- Whoever can read the order (Admins, Finance, covering Managers, the
-- assigned technician).
create policy customer_feedback_read on customer_feedback
  for select to authenticated
  using (exists (select 1 from orders o where o.id = customer_feedback.order_id));

-- Every feedback of an order with names and the visit's Job Done time.
create view order_feedback with (security_invoker = true) as
select
  f.id,
  f.message_id,
  f.order_id,
  f.technician_id,
  t.name as technician_name,
  f.branch_id,
  f.rating,
  f.working_well,
  f.comment,
  f.source,
  f.recorded_by,
  r.name as recorded_by_name,
  f.created_at,
  m.created_at as job_done_at
from customer_feedback f
join customer_messages m on m.id = f.message_id
left join staff t on t.id = f.technician_id
left join staff r on r.id = f.recorded_by;

-- order_review_summary (same columns as 0004), plus the latest rating.
create or replace view order_review_summary with (security_invoker = true) as
select
  s.*,
  c.completed_at,
  ct.name as completion_technician_name,
  (select count(*) from audit_log a
    where a.order_id = s.id and a.action = 'returned_for_rework')::integer as return_count,
  rr.created_at as last_returned_at,
  rr.note       as last_return_note,
  m.id          as latest_message_id,
  m.channel     as latest_message_channel,
  m.status      as latest_message_status,
  (select count(*) from payments p where p.order_id = s.id)::integer as payment_count,
  (select count(*) from payments p
    where p.order_id = s.id and p.method <> 'cash' and p.verified_at is null)::integer as unverified_count,
  rv.created_at as reviewed_at,
  rv.actor_name as reviewed_by_name,
  rv.note       as review_note,
  cl.created_at as closed_at,
  cl.actor_name as closed_by_name,
  fb.rating       as latest_rating,
  fb.working_well as latest_working_well
from order_summary s
left join order_completions c on c.order_id = s.id
left join staff ct on ct.id = c.technician_id
left join lateral (
  select a.created_at, a.note from audit_log a
   where a.order_id = s.id and a.action = 'returned_for_rework'
   order by a.id desc limit 1) rr on true
left join lateral (
  select cm.id, cm.channel, cm.status from customer_messages cm
   where cm.order_id = s.id
   order by cm.created_at desc, cm.id desc limit 1) m on true
left join lateral (
  select a.created_at, a.note, st.name as actor_name from audit_log a
    join staff st on st.id = a.actor_id
   where a.order_id = s.id and a.action = 'reviewed'
   order by a.id desc limit 1) rv on true
left join lateral (
  select a.created_at, st.name as actor_name from audit_log a
    join staff st on st.id = a.actor_id
   where a.order_id = s.id and a.action = 'closed'
   order by a.id desc limit 1) cl on true
left join lateral (
  select f.rating, f.working_well from customer_feedback f
    join customer_messages fm on fm.id = f.message_id
   where f.order_id = s.id
   order by fm.created_at desc, fm.id desc limit 1) fb on true;

-- ---------------------------------------------------------------------------
-- Privileges
-- * app_settings: no client role (only the definer functions read it).
-- * customer_feedback and order_feedback: read-only for signed-in staff.
-- * anon: schema usage and the two customer page functions, nothing else.
-- * authenticated: the two customer page functions (a signed-in browser
--   behaves the same), record_phone_feedback, and the link helpers the
--   latest_customer_messages view calls.
-- ---------------------------------------------------------------------------
revoke all on app_settings, customer_feedback, order_feedback from public, anon, authenticated, service_role;
grant select on customer_feedback, order_feedback to authenticated;

grant usage on schema public to anon;

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
         '_new_feedback_token', 'customer_messages_guard', 'orders_customer_message',
         '_feedback_link_placeholder', '_feedback_link', '_customer_message_full_text',
         'confirm_customer_message', 'customer_feedback_guard', '_is_low_feedback',
         '_check_feedback', '_feedback_link_state', '_feedback_state_error', '_notify_low_feedback',
         'feedback_form', 'submit_feedback', '_phone_feedback_error', 'record_phone_feedback')
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', r.sig);
    if r.proname in ('feedback_form', 'submit_feedback') then
      execute format('grant execute on function %s to anon, authenticated', r.sig);
    elsif r.proname in ('confirm_customer_message', 'record_phone_feedback',
                        '_feedback_link', '_customer_message_full_text') then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;
