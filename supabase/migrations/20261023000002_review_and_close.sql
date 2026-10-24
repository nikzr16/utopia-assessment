-- 0004 Review and close: Manager review and Finance close screens.
-- Builds on 0000-0003; nothing here edits an earlier file.
--
-- * Branch cover: a Manager covers their home branch (staff.branch_id) and
--   every branch in staff.additional_branch_ids (Managers only). A Manager
--   reads, reviews and is told about orders of covered branches only.
-- * Every branch needs a Manager: a branch with any active non-Manager staff
--   must keep an active covering Manager (checked when the transaction
--   commits, so one script may add the Manager and the staff in any order),
--   and an order can only be created for (or moved to) a branch with one.
-- * Approve (Job Done -> Reviewed) needs a covering Manager and a customer
--   who was told (latest message sent or told by phone). Return for rework
--   needs a covering Manager. Close needs every non-cash payment verified.
-- * Payment verification: Finance ticks each non-cash payment Verified
--   (verify_payment) and may undo it (unverify_payment) until the order is
--   Closed.
-- * A covering Manager can confirm the customer message; the WhatsApp text
--   they send says it is sent on behalf of the technician
--   (_customer_on_behalf_message) and is saved as the sent text.
-- * The technician is told when their job is approved and when it is closed.
-- * Reads: order_review_summary (order_summary plus review facts), the queue
--   functions manager_orders / finance_orders, and covered_branches.
--
-- src/domain/review.ts mirrors the rules; tests/db/parity.test.ts keeps both
-- identical.

-- ---------------------------------------------------------------------------
-- Branch cover
-- ---------------------------------------------------------------------------
alter table staff add column additional_branch_ids uuid[] not null default '{}';

-- Keep the additional branches valid: Managers only, existing branches, no
-- duplicates, and not the home branch again.
create function staff_additional_branches_check() returns trigger
language plpgsql as $$
begin
  if new.additional_branch_ids is null then
    new.additional_branch_ids := '{}';
  end if;
  if cardinality(new.additional_branch_ids) = 0 then
    return new;
  end if;
  if new.role <> 'manager' then
    raise exception 'Only Managers can cover additional branches';
  end if;
  if array_position(new.additional_branch_ids, null) is not null
     or exists (
       select 1 from unnest(new.additional_branch_ids) as a(id)
        where not exists (select 1 from branches b where b.id = a.id)) then
    raise exception 'Choose existing branches as additional branches';
  end if;
  if new.branch_id = any (new.additional_branch_ids) then
    raise exception 'The home branch cannot also be an additional branch';
  end if;
  if (select count(distinct a.id) from unnest(new.additional_branch_ids) as a(id))
     <> cardinality(new.additional_branch_ids) then
    raise exception 'An additional branch is listed twice';
  end if;
  return new;
end;
$$;

create trigger staff_additional_branches_trg
  before insert or update of role, branch_id, additional_branch_ids on staff
  for each row execute function staff_additional_branches_check();

-- May this staff member act as a Manager of this branch?
create function _covers_branch(p_staff staff, p_branch_id uuid) returns boolean
language sql stable as $$
  select coalesce(
    p_staff.role = 'manager'
    and p_staff.active
    and (p_staff.branch_id = p_branch_id or p_branch_id = any (p_staff.additional_branch_ids)),
    false);
$$;

-- Does the branch have an active Manager (home or additional)?
create function _branch_has_manager(p_branch_id uuid) returns boolean
language sql stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from staff s
     where s.role = 'manager'
       and s.active
       and (s.branch_id = p_branch_id or p_branch_id = any (s.additional_branch_ids)));
$$;

create function _branch_no_manager_error(p_branch_id uuid) returns text
language sql stable as $$
  select format('%s has no Manager. Add a Manager to this branch first.',
    coalesce((select name from branches where id = p_branch_id), 'This branch'));
$$;

-- ---------------------------------------------------------------------------
-- Every branch needs a Manager
-- ---------------------------------------------------------------------------
-- Checked at commit for every branch a staff change touches: a branch with
-- any active non-Manager staff must still have an active covering Manager.
create function staff_branch_manager_check() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_branches uuid[] := '{}';
  v_branch   uuid;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    v_branches := v_branches || old.branch_id || old.additional_branch_ids;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    v_branches := v_branches || new.branch_id || new.additional_branch_ids;
  end if;
  foreach v_branch in array v_branches loop
    if exists (
         select 1 from staff s
          where s.active and s.role <> 'manager' and s.branch_id = v_branch)
       and not _branch_has_manager(v_branch) then
      raise exception '%', _branch_no_manager_error(v_branch);
    end if;
  end loop;
  return null;
end;
$$;

create constraint trigger staff_branch_manager_trg
  after insert or update or delete on staff
  deferrable initially deferred
  for each row execute function staff_branch_manager_check();

-- An order can only be created for, or moved to, a branch with a Manager.
create function orders_branch_manager_check() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if (tg_op = 'INSERT' or new.branch_id is distinct from old.branch_id)
     and not _branch_has_manager(new.branch_id) then
    raise exception '%', _branch_no_manager_error(new.branch_id);
  end if;
  return new;
end;
$$;

create trigger orders_branch_manager_trg
  before insert or update of branch_id on orders
  for each row execute function orders_branch_manager_check();

-- ---------------------------------------------------------------------------
-- Payment verification columns
-- ---------------------------------------------------------------------------
alter table payments add column verified_by uuid references staff (id);
alter table payments add column verified_at timestamptz;
alter table payments add constraint payments_verified_check check (
  (verified_by is null) = (verified_at is null)
  and (verified_by is null or method <> 'cash'));

-- ---------------------------------------------------------------------------
-- Notifications: the technician is told on approve and close
-- ---------------------------------------------------------------------------
alter table notifications drop constraint notifications_event_check;
alter table notifications add constraint notifications_event_check
  check (event in ('assigned', 'job_done', 'rework', 'reviewed', 'order_updated',
                   'cancelled', 'reassigned_away', 'payment_recorded',
                   'job_approved', 'job_closed'));

-- ---------------------------------------------------------------------------
-- Reads: Managers see covered branches only
-- ---------------------------------------------------------------------------
-- Policy helper: does the signed-in user cover this branch as a Manager?
create function _current_staff_covers(p_branch_id uuid) returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select _covers_branch(s, p_branch_id) from staff s where s.auth_user_id = auth.uid() and s.active),
    false);
$$;

-- Admins and Finance read every order; a Manager the orders of covered
-- branches; a technician the orders assigned to them. Everything that hangs
-- off an order (and order_summary) follows this policy.
drop policy orders_read on orders;
create policy orders_read on orders
  for select to authenticated
  using (
    case _current_staff_role()
      when 'admin'      then true
      when 'finance'    then true
      when 'manager'    then _current_staff_covers(branch_id)
      when 'technician' then assigned_technician_id = _current_staff_id()
      else false
    end
  );

-- Customer messages: whoever can read the order (0003 limited this to the
-- assigned technician and Admins).
drop policy customer_messages_read on customer_messages;
create policy customer_messages_read on customer_messages
  for select to authenticated
  using (exists (select 1 from orders o where o.id = customer_messages.order_id));

-- Storage: job files follow the same rule (same signature as 0002).
create or replace function _can_access_job_file(p_name text, p_action text) returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_order_id uuid := _job_file_order(p_name);
  v_actor    staff;
  v_order    orders;
begin
  if v_order_id is null then
    return false;
  end if;
  select * into v_actor from staff where auth_user_id = auth.uid() and active;
  if not found then
    return false;
  end if;
  select * into v_order from orders where id = v_order_id;
  if not found then
    return false;
  end if;

  if p_action = 'read' then
    return case v_actor.role
      when 'admin'      then true
      when 'finance'    then true
      when 'manager'    then _covers_branch(v_actor, v_order.branch_id)
      when 'technician' then v_order.assigned_technician_id = v_actor.id
      else false
    end;
  end if;
  if _job_file_write_error(v_actor, v_order, _job_file_is_receipt(p_name)) is not null then
    return false;
  end if;
  if p_action = 'upload' then
    return true;
  end if;
  if p_action = 'delete' then
    return not exists (select 1 from attachments a where a.storage_path = p_name);
  end if;
  return false;
end;
$$;

-- ---------------------------------------------------------------------------
-- Lifecycle guards (same signature as 0000)
-- ---------------------------------------------------------------------------
create or replace function _authorize_transition(
  p_actor staff,
  p_order orders,
  p_to order_status,
  p_note text
) returns order_status_transitions
language plpgsql as $$
declare
  v_rule order_status_transitions;
  v_other_role staff_role;
  v_phrase text := _transition_phrase(p_order.status, p_to);
  v_balance numeric;
  v_unverified integer;
begin
  if p_order.status in ('closed', 'cancelled') then
    raise exception '% is % and can no longer be changed', p_order.order_no, _status_label(p_order.status);
  end if;

  select * into v_rule
    from order_status_transitions
   where from_status = p_order.status
     and to_status = p_to
     and actor_role = p_actor.role;

  if not found then
    -- Wrong role? First: is this exact move legal for a different role?
    select actor_role into v_other_role
      from order_status_transitions
     where from_status = p_order.status and to_status = p_to
     order by actor_role
     limit 1;
    -- Otherwise, if only one role can ever move an order to this status
    -- (for example only Finance closes), name that role.
    if v_other_role is null then
      select min(actor_role) into v_other_role
        from order_status_transitions
       where to_status = p_to
      having count(distinct actor_role) = 1;
      if v_other_role = p_actor.role then
        v_other_role := null;
      end if;
    end if;
    if v_other_role is not null then
      raise exception 'Only % can %',
        case when v_other_role = 'technician' then 'the assigned technician'
             else initcap(v_other_role::text) end,
        v_phrase;
    end if;

    if p_to = 'assigned' then
      raise exception 'An order can only be reassigned while it is Assigned or Acknowledged (it is currently %)',
        _status_label(p_order.status);
    elsif p_to = 'cancelled' then
      raise exception 'An order can only be cancelled while it is New, Assigned or Acknowledged (it is currently %)',
        _status_label(p_order.status);
    elsif p_to = 'job_done' then
      raise exception 'A completion record can only be submitted while the job is In Progress (it is currently %)',
        _status_label(p_order.status);
    end if;
    raise exception 'An order cannot change from % to %',
      _status_label(p_order.status), _status_label(p_to);
  end if;

  if v_rule.assigned_technician_only
     and p_order.assigned_technician_id is distinct from p_actor.id then
    raise exception 'Only the assigned technician can %', v_phrase;
  end if;

  -- 0004: a Manager reviews only the branches they cover.
  if v_rule.actor_role = 'manager' and not _covers_branch(p_actor, p_order.branch_id) then
    raise exception 'Only a Manager of % can %',
      (select name from branches where id = p_order.branch_id), v_phrase;
  end if;

  if v_rule.note_required and btrim(coalesce(p_note, '')) = '' then
    if p_to = 'cancelled' then
      raise exception 'A reason is required to cancel an order';
    end if;
    raise exception 'A review note is required to return a job for rework';
  end if;

  -- 0004: approve only once the customer was told the job is done.
  if p_order.status = 'job_done' and p_to = 'reviewed' and exists (
       select 1 from latest_customer_messages m
        where m.order_id = p_order.id and m.status = 'not_sent') then
    raise exception 'Tell the customer the job is done before approving';
  end if;

  if v_rule.paid_required and _payment_status(p_order.id) <> 'paid' then
    select balance into v_balance from order_summary where id = p_order.id;
    raise exception 'Order must be fully paid before closing (outstanding balance RM %)', to_char(v_balance, 'FM999999990.00');
  end if;

  -- 0004: close only once every non-cash payment is verified.
  if p_to = 'closed' then
    select count(*) into v_unverified
      from payments
     where order_id = p_order.id and method <> 'cash' and verified_at is null;
    if v_unverified > 0 then
      raise exception 'Verify every receipt before closing (% not verified yet)', v_unverified;
    end if;
  end if;

  return v_rule;
end;
$$;

-- ---------------------------------------------------------------------------
-- submit_completion (same signature as 0002): every Manager covering the
-- order's branch is told.
-- ---------------------------------------------------------------------------
create or replace function submit_completion(
  p_order_id      uuid,
  p_work_done     text,
  p_extra_charges numeric default 0,
  p_remarks       text default null
) returns orders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor   staff := _require_actor();
  v_order   orders := _lock_order(p_order_id);
  v_extra   numeric;
  v_manager record;
begin
  perform _authorize_transition(v_actor, v_order, 'job_done', null);

  if btrim(coalesce(p_work_done, '')) = '' then
    raise exception 'Describe the work done before submitting';
  end if;
  v_extra := _check_extra_charges(p_extra_charges);
  if v_extra > 0 and btrim(coalesce(p_remarks, '')) = '' then
    raise exception 'Explain the extra charges in the remarks';
  end if;

  insert into order_completions (order_id, work_done, extra_charges, remarks, technician_id, completed_at)
  values (v_order.id, btrim(p_work_done), v_extra,
          nullif(btrim(coalesce(p_remarks, '')), ''), v_actor.id, now())
  on conflict (order_id) do update
    set work_done     = excluded.work_done,
        extra_charges = excluded.extra_charges,
        remarks       = excluded.remarks,
        technician_id = excluded.technician_id,
        completed_at  = excluded.completed_at;

  update orders set status = 'job_done' where id = v_order.id returning * into v_order;

  perform _audit(v_order.id, v_actor, 'completion_submitted', 'in_progress', 'job_done', p_remarks,
    jsonb_build_object(
      'extra_charges', v_extra,
      'final_amount', v_order.quoted_price + v_extra));

  for v_manager in
    select s.id from staff s
     where s.role = 'manager'
       and s.active
       and (s.branch_id = v_order.branch_id or v_order.branch_id = any (s.additional_branch_ids))
  loop
    perform _notify(v_manager.id, v_order.id, 'job_done',
      format('%s is done and awaiting your review', v_order.order_no));
  end loop;

  return v_order;
end;
$$;

-- ---------------------------------------------------------------------------
-- transition_order (same signature as 0002): also tell the technician when
-- their job is approved and when it is closed.
-- ---------------------------------------------------------------------------
create or replace function transition_order(
  p_order_id      uuid,
  p_to_status     order_status,
  p_note          text default null,
  p_technician_id uuid default null
) returns orders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor    staff := _require_actor();
  v_order    orders := _lock_order(p_order_id);
  v_rule     order_status_transitions;
  v_from     order_status := v_order.status;
  v_new_tech staff;
  v_old_tech staff;
  v_action   text;
  v_details  jsonb := '{}'::jsonb;
  v_technician_id uuid := v_order.assigned_technician_id;
  v_finance  record;
begin
  if p_to_status = 'job_done' then
    raise exception 'Submit the completion record to mark a job as done';
  end if;

  v_rule := _authorize_transition(v_actor, v_order, p_to_status, p_note);

  if p_to_status = 'assigned' then
    v_new_tech := _require_technician(p_technician_id);
    if v_from in ('assigned', 'acknowledged') then
      if v_new_tech.id = v_order.assigned_technician_id then
        raise exception 'Choose a different technician to reassign this order';
      end if;
      select * into v_old_tech from staff where id = v_order.assigned_technician_id;
      v_action := 'reassigned';
      v_details := jsonb_build_object(
        'previous_technician_id', v_old_tech.id,
        'previous_technician_name', v_old_tech.name,
        'new_technician_id', v_new_tech.id,
        'new_technician_name', v_new_tech.name);
    else
      v_action := 'assigned';
      v_details := jsonb_build_object(
        'technician_id', v_new_tech.id,
        'technician_name', v_new_tech.name);
    end if;
    v_technician_id := v_new_tech.id;
  else
    v_action := case p_to_status
      when 'acknowledged' then 'acknowledged'
      when 'in_progress'  then case when v_from = 'job_done' then 'returned_for_rework' else 'started' end
      when 'reviewed'     then 'reviewed'
      when 'closed'       then 'closed'
      when 'cancelled'    then 'cancelled'
    end;
  end if;

  update orders
     set status = p_to_status,
         assigned_technician_id = v_technician_id
   where id = v_order.id
   returning * into v_order;

  perform _audit(v_order.id, v_actor, v_action, v_from, p_to_status, p_note, v_details);

  -- Notifications
  if p_to_status = 'assigned' then
    perform _notify(v_technician_id, v_order.id, 'assigned',
      case when v_from = 'new'
           then format('%s has been assigned to you', v_order.order_no)
           else format('%s has been reassigned to you', v_order.order_no) end);
    if v_old_tech.id is not null then
      perform _notify(v_old_tech.id, v_order.id, 'reassigned_away',
        format('%s has been reassigned to another technician', v_order.order_no));
    end if;
  elsif v_action = 'returned_for_rework' then
    perform _notify(v_order.assigned_technician_id, v_order.id, 'rework',
      format('%s was returned for rework: %s', v_order.order_no, btrim(p_note)));
  elsif p_to_status = 'reviewed' then
    for v_finance in select id from staff where role = 'finance' and active loop
      perform _notify(v_finance.id, v_order.id, 'reviewed',
        format('%s has been reviewed and is ready for payment verification', v_order.order_no));
    end loop;
    if v_order.assigned_technician_id is not null then
      perform _notify(v_order.assigned_technician_id, v_order.id, 'job_approved',
        format('%s was approved by %s', v_order.order_no, v_actor.name));
    end if;
  elsif p_to_status = 'closed' then
    if v_order.assigned_technician_id is not null then
      perform _notify(v_order.assigned_technician_id, v_order.id, 'job_closed',
        format('%s was closed by %s', v_order.order_no, v_actor.name));
    end if;
  elsif p_to_status = 'cancelled' and v_order.assigned_technician_id is not null then
    perform _notify(v_order.assigned_technician_id, v_order.id, 'cancelled',
      format('%s was cancelled: %s', v_order.order_no, btrim(p_note)));
  end if;

  return v_order;
end;
$$;

-- ---------------------------------------------------------------------------
-- Payment verification
-- ---------------------------------------------------------------------------
-- Finance only; non-cash payments only; while the order is not Closed.
-- Returns null when allowed, else the message.
create function _payment_verify_error(p_actor staff, p_order orders, p_payment payments) returns text
language plpgsql stable as $$
begin
  if p_actor.role <> 'finance' then
    return 'Only Finance can verify payments';
  end if;
  if p_payment.method = 'cash' then
    return 'Cash payments do not need verifying';
  end if;
  if p_order.status in ('closed', 'cancelled') then
    return format('%s is %s and its payments can no longer be changed',
      p_order.order_no, _status_label(p_order.status));
  end if;
  return null;
end;
$$;

create function _set_payment_verified(p_payment_id uuid, p_verified boolean) returns payments
language plpgsql as $$
declare
  v_actor   staff := _require_actor();
  v_payment payments;
  v_order   orders;
  v_error   text;
begin
  select * into v_payment from payments where id = p_payment_id;
  if not found then
    raise exception 'Payment not found';
  end if;
  v_order := _lock_order(v_payment.order_id);
  -- Re-read under the order lock.
  select * into v_payment from payments where id = p_payment_id;

  v_error := _payment_verify_error(v_actor, v_order, v_payment);
  if v_error is not null then
    raise exception '%', v_error;
  end if;
  if p_verified and v_payment.verified_at is not null then
    raise exception 'Already verified by % at %',
      coalesce((select name from staff where id = v_payment.verified_by), 'someone'),
      _malaysia_date_time(v_payment.verified_at);
  end if;
  if not p_verified and v_payment.verified_at is null then
    raise exception 'This payment is not verified';
  end if;

  update payments
     set verified_by = case when p_verified then v_actor.id end,
         verified_at = case when p_verified then now() end
   where id = v_payment.id
   returning * into v_payment;

  perform _audit(v_order.id, v_actor,
    case when p_verified then 'payment_verified' else 'payment_unverified' end,
    null, null, null,
    jsonb_build_object(
      'payment_id', v_payment.id,
      'amount', v_payment.amount,
      'method', v_payment.method,
      'status', v_order.status));

  return v_payment;
end;
$$;

create function verify_payment(p_payment_id uuid) returns payments
language sql
security definer
set search_path = public, pg_temp
as $$
  select * from _set_payment_verified(p_payment_id, true);
$$;

create function unverify_payment(p_payment_id uuid) returns payments
language sql
security definer
set search_path = public, pg_temp
as $$
  select * from _set_payment_verified(p_payment_id, false);
$$;

-- ---------------------------------------------------------------------------
-- Customer message from a Manager ("on behalf of" the technician)
-- ---------------------------------------------------------------------------
-- Same facts as _customer_job_done_message, written by the Manager.
-- Mirrored by customerOnBehalfMessage in src/domain/review.ts.
create function _customer_on_behalf_message(
  p_customer_name   text,
  p_order_no        text,
  p_manager_name    text,
  p_branch_name     text,
  p_technician_name text,
  p_completed_at    timestamptz
) returns text
language sql stable as $$
  select format(
    'Hi %s, this is %s, Manager at Sejuk Sejuk Service %s, on behalf of Technician %s. Job %s was completed at %s. Please check and leave feedback. Thank you!',
    p_customer_name, p_manager_name, p_branch_name, p_technician_name, p_order_no,
    _malaysia_date_time(p_completed_at));
$$;

-- Who may edit or confirm, and when (same signature as 0003). A Manager
-- covering the order's branch may confirm (send) but not edit.
create or replace function _customer_message_error(
  p_actor staff,
  p_order orders,
  p_msg   customer_messages,
  p_verb  text
) returns text
language plpgsql stable as $$
begin
  if p_actor.role = 'manager' and _covers_branch(p_actor, p_order.branch_id) then
    if p_verb <> 'confirmed' then
      return 'Managers send the prepared message as it is; only the assigned technician or an Admin can edit it';
    end if;
  elsif not (
    p_actor.role = 'admin'
    or (p_actor.role = 'technician' and p_order.assigned_technician_id = p_actor.id)
  ) then
    return 'Only the assigned technician, an Admin or a Manager of the branch can send the customer message of an order';
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

-- confirm_customer_message (same signature as 0003): a Manager's WhatsApp
-- message is saved with the on-behalf text it was sent with.
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
      'body', v_msg.body,
      'edited', v_msg.edited_at is not null,
      'on_behalf', v_on_behalf,
      'status', v_order.status));

  return v_msg;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reads: order_review_summary and the queues
-- ---------------------------------------------------------------------------
-- order_summary plus what the review and close screens need. security_invoker,
-- so every policy above applies through it.
create view order_review_summary with (security_invoker = true) as
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
  cl.actor_name as closed_by_name
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
   order by a.id desc limit 1) cl on true;

-- The signed-in Manager's queue for one tab, covered branches only
-- (optionally one of them):
--   to_review  Job Done (oldest first)
--   returned   sent back for rework and not resubmitted yet (latest first)
--   reviewed   approved in the last 30 days (latest first)
create function manager_orders(p_view text default 'to_review', p_branch_id uuid default null)
returns setof order_review_summary
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor staff := _require_actor();
begin
  if v_actor.role <> 'manager' then
    raise exception 'Only Managers have a review queue';
  end if;
  if p_view = 'to_review' then
    return query
      select * from order_review_summary r
       where _covers_branch(v_actor, r.branch_id)
         and (p_branch_id is null or r.branch_id = p_branch_id)
         and r.status = 'job_done'
       order by r.completed_at nulls last, r.order_no;
  elsif p_view = 'returned' then
    return query
      select * from order_review_summary r
       where _covers_branch(v_actor, r.branch_id)
         and (p_branch_id is null or r.branch_id = p_branch_id)
         and r.status = 'in_progress'
         and r.return_count > 0
       order by r.last_returned_at desc, r.order_no desc;
  elsif p_view = 'reviewed' then
    return query
      select * from order_review_summary r
       where _covers_branch(v_actor, r.branch_id)
         and (p_branch_id is null or r.branch_id = p_branch_id)
         and r.status in ('reviewed', 'closed')
         and r.reviewed_at >= now() - interval '30 days'
       order by r.reviewed_at desc, r.order_no desc;
  else
    raise exception 'Unknown review queue view: %', p_view;
  end if;
end;
$$;

-- Finance's queue for one tab, every branch (optionally one):
--   not_reviewed  In Progress / Job Done with at least one payment (latest first)
--   ready         Reviewed and fully paid (oldest review first)
--   outstanding   Reviewed, unpaid or partly paid (oldest review first)
--   closed        closed in the last 30 days (latest first)
create function finance_orders(p_view text default 'ready', p_branch_id uuid default null)
returns setof order_review_summary
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor staff := _require_actor();
begin
  if v_actor.role <> 'finance' then
    raise exception 'Only Finance has a payment queue';
  end if;
  if p_view = 'not_reviewed' then
    return query
      select * from order_review_summary r
       where (p_branch_id is null or r.branch_id = p_branch_id)
         and r.status in ('in_progress', 'job_done')
         and r.payment_count > 0
       order by r.updated_at desc, r.order_no desc;
  elsif p_view = 'ready' then
    return query
      select * from order_review_summary r
       where (p_branch_id is null or r.branch_id = p_branch_id)
         and r.status = 'reviewed'
         and r.payment_status = 'paid'
       order by r.reviewed_at nulls last, r.order_no;
  elsif p_view = 'outstanding' then
    return query
      select * from order_review_summary r
       where (p_branch_id is null or r.branch_id = p_branch_id)
         and r.status = 'reviewed'
         and r.payment_status <> 'paid'
       order by r.reviewed_at nulls last, r.order_no;
  elsif p_view = 'closed' then
    return query
      select * from order_review_summary r
       where (p_branch_id is null or r.branch_id = p_branch_id)
         and r.status = 'closed'
         and r.closed_at >= now() - interval '30 days'
       order by r.closed_at desc, r.order_no desc;
  else
    raise exception 'Unknown payment queue view: %', p_view;
  end if;
end;
$$;

-- The signed-in Manager's branches: home first, then additional by name.
create function covered_branches() returns table (id uuid, name text, home boolean)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor staff := _require_actor();
begin
  if v_actor.role <> 'manager' then
    raise exception 'Only Managers cover branches';
  end if;
  return query
    select b.id, b.name, b.id = v_actor.branch_id
      from branches b
     where _covers_branch(v_actor, b.id)
     order by b.id = v_actor.branch_id desc, b.name;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges: the view read-only for signed-in staff (RLS narrows the rows);
-- the RPCs and the policy helper for signed-in staff; the rest internal.
-- (submit_completion, transition_order, confirm_customer_message and
-- _can_access_job_file keep the grants they already had.)
-- ---------------------------------------------------------------------------
revoke all on order_review_summary from public, anon, authenticated, service_role;
grant select on order_review_summary to authenticated;

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
         'staff_additional_branches_check', '_covers_branch', '_branch_has_manager',
         '_branch_no_manager_error', 'staff_branch_manager_check', 'orders_branch_manager_check',
         '_current_staff_covers', '_payment_verify_error', '_set_payment_verified',
         'verify_payment', 'unverify_payment', '_customer_on_behalf_message',
         'manager_orders', 'finance_orders', 'covered_branches')
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', r.sig);
    if r.proname in ('_current_staff_covers', 'verify_payment', 'unverify_payment',
                     'manager_orders', 'finance_orders', 'covered_branches') then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;
