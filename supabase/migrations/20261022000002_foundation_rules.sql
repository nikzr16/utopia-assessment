-- 0000 System foundation: lifecycle rules, RPCs, audit and notifications.
-- The database is the single authority for who may move an order where.
-- All writes go through the RPCs below; each runs in one transaction and
-- either writes everything (order change, audit entry, notifications) or
-- raises a plain-language error and writes nothing.
--
-- The actor is always the signed-in user: no RPC takes an actor parameter.
-- _require_actor() resolves auth.uid() (Supabase Auth) to an active staff row.

-- ---------------------------------------------------------------------------
-- Rules as data
-- ---------------------------------------------------------------------------
create table order_status_transitions (
  from_status              order_status not null,
  to_status                order_status not null,
  actor_role               staff_role not null,
  assigned_technician_only boolean not null default false,
  note_required            boolean not null default false,
  paid_required            boolean not null default false,
  primary key (from_status, to_status, actor_role)
);

-- Creating an order (-> new / -> assigned) is handled by create_order.
-- in_progress -> job_done is reachable only through submit_completion.
insert into order_status_transitions
  (from_status, to_status, actor_role, assigned_technician_only, note_required, paid_required)
values
  -- Assign / reassign (Admin)
  ('new',          'assigned',    'admin',      false, false, false),
  ('assigned',     'assigned',    'admin',      false, false, false),
  ('acknowledged', 'assigned',    'admin',      false, false, false),
  -- Technician work (assigned technician only)
  ('assigned',     'acknowledged','technician', true,  false, false),
  ('assigned',     'in_progress', 'technician', true,  false, false),
  ('acknowledged', 'in_progress', 'technician', true,  false, false),
  ('in_progress',  'job_done',    'technician', true,  false, false),
  -- Manager review
  ('job_done',     'reviewed',    'manager',    false, false, false),
  ('job_done',     'in_progress', 'manager',    false, true,  false),
  -- Finance close (must be fully paid)
  ('reviewed',     'closed',      'finance',    false, false, true),
  -- Cancel before work starts (Admin, reason required)
  ('new',          'cancelled',   'admin',      false, true,  false),
  ('assigned',     'cancelled',   'admin',      false, true,  false),
  ('acknowledged', 'cancelled',   'admin',      false, true,  false);

-- ---------------------------------------------------------------------------
-- Internal helpers (not exposed to API roles; see end of file)
-- ---------------------------------------------------------------------------
create function _status_label(p_status order_status) returns text
language sql immutable as $$
  select initcap(replace(p_status::text, '_', ' '));
$$;

-- Verb phrase used in "Only X can ..." messages.
create function _transition_phrase(p_from order_status, p_to order_status) returns text
language sql immutable as $$
  select case
    when p_to = 'assigned'     then 'assign or reassign an order'
    when p_to = 'acknowledged' then 'acknowledge a job'
    when p_to = 'in_progress' and p_from = 'job_done' then 'return a job for rework'
    when p_to = 'in_progress'  then 'start a job'
    when p_to = 'job_done'     then 'submit a completion record'
    when p_to = 'reviewed'     then 'review a job'
    when p_to = 'closed'       then 'close an order'
    when p_to = 'cancelled'    then 'cancel an order'
    else 'make this change'
  end;
$$;

-- The acting staff member: the signed-in user's active staff row.
create function _require_actor() returns staff
language plpgsql as $$
declare
  v_uid   uuid := auth.uid();
  v_actor staff;
begin
  if v_uid is null then
    raise exception 'You must be signed in';
  end if;
  select * into v_actor from staff where auth_user_id = v_uid and active;
  if not found then
    raise exception 'Your account has no active staff profile';
  end if;
  return v_actor;
end;
$$;

create function _lock_order(p_order_id uuid) returns orders
language plpgsql as $$
declare
  v_order orders;
begin
  select * into v_order from orders where id = p_order_id for update;
  if not found then
    raise exception 'Order not found';
  end if;
  return v_order;
end;
$$;

create function _require_technician(p_technician_id uuid) returns staff
language plpgsql as $$
declare
  v_tech staff;
begin
  if p_technician_id is null then
    raise exception 'Select a technician to assign';
  end if;
  select * into v_tech from staff where id = p_technician_id and active;
  if not found or v_tech.role <> 'technician' then
    raise exception 'The selected person is not an active technician';
  end if;
  return v_tech;
end;
$$;

create function _audit(
  p_order_id uuid,
  p_actor staff,
  p_action text,
  p_from order_status,
  p_to order_status,
  p_note text,
  p_details jsonb
) returns void
language plpgsql as $$
begin
  insert into audit_log (order_id, actor_id, actor_role, action, from_status, to_status, note, details)
  values (p_order_id, p_actor.id, p_actor.role, p_action, p_from, p_to,
          nullif(btrim(coalesce(p_note, '')), ''), coalesce(p_details, '{}'::jsonb));
end;
$$;

create function _notify(p_recipient_id uuid, p_order_id uuid, p_event text, p_message text) returns void
language plpgsql as $$
begin
  insert into notifications (recipient_id, order_id, event, message)
  values (p_recipient_id, p_order_id, p_event, p_message);
end;
$$;

create function _payment_status(p_order_id uuid) returns text
language sql as $$
  select payment_status from order_summary where id = p_order_id;
$$;

-- Checks role, assignment, note and payment conditions for a status change and
-- returns the matching rule. Raises a plain-language error otherwise.
create function _authorize_transition(
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

  if v_rule.note_required and btrim(coalesce(p_note, '')) = '' then
    if p_to = 'cancelled' then
      raise exception 'A reason is required to cancel an order';
    end if;
    raise exception 'A review note is required to return a job for rework';
  end if;

  if v_rule.paid_required and _payment_status(p_order.id) <> 'paid' then
    select balance into v_balance from order_summary where id = p_order.id;
    raise exception 'Order must be fully paid before closing (outstanding balance RM %)', to_char(v_balance, 'FM999999990.00');
  end if;

  return v_rule;
end;
$$;

-- ---------------------------------------------------------------------------
-- create_order
-- ---------------------------------------------------------------------------
create function create_order(
  p_branch_id           uuid,
  p_customer_name       text,
  p_customer_phone      text,
  p_customer_address    text,
  p_problem_description text,
  p_service_type_id     uuid,
  p_quoted_price        numeric,
  p_scheduled_at        timestamptz default null,
  p_admin_notes         text default null,
  p_technician_id       uuid default null
) returns orders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor  staff := _require_actor();
  v_tech   staff;
  v_order  orders;
  v_status order_status;
begin
  if v_actor.role <> 'admin' then
    raise exception 'Only Admin can create an order';
  end if;
  if btrim(coalesce(p_customer_name, '')) = '' then
    raise exception 'Customer name is required';
  end if;
  if btrim(coalesce(p_customer_phone, '')) = '' then
    raise exception 'Customer phone is required';
  end if;
  if btrim(coalesce(p_customer_address, '')) = '' then
    raise exception 'Customer address is required';
  end if;
  if btrim(coalesce(p_problem_description, '')) = '' then
    raise exception 'Problem description is required';
  end if;
  if p_quoted_price is null or p_quoted_price < 0 then
    raise exception 'Quoted price must be zero or more';
  end if;
  if not exists (select 1 from branches where id = p_branch_id) then
    raise exception 'Select a valid branch';
  end if;
  if not exists (select 1 from service_types where id = p_service_type_id and active) then
    raise exception 'Select a valid service type';
  end if;

  if p_technician_id is not null then
    v_tech := _require_technician(p_technician_id);
    v_status := 'assigned';
  else
    v_status := 'new';
  end if;

  insert into orders (
    branch_id, customer_name, customer_phone, customer_address, problem_description,
    service_type_id, quoted_price, assigned_technician_id, admin_notes, status,
    scheduled_at, created_by
  ) values (
    p_branch_id, btrim(p_customer_name), btrim(p_customer_phone), btrim(p_customer_address),
    btrim(p_problem_description), p_service_type_id, p_quoted_price, p_technician_id,
    nullif(btrim(coalesce(p_admin_notes, '')), ''), v_status, p_scheduled_at, v_actor.id
  ) returning * into v_order;

  perform _audit(v_order.id, v_actor, 'created', null, v_status, null,
    jsonb_build_object(
      'order_no', v_order.order_no,
      'technician_id', p_technician_id,
      'technician_name', v_tech.name));

  if p_technician_id is not null then
    perform _notify(p_technician_id, v_order.id, 'assigned',
      format('%s has been assigned to you', v_order.order_no));
  end if;

  return v_order;
end;
$$;

-- ---------------------------------------------------------------------------
-- transition_order: assign, reassign, acknowledge, start, review,
-- return for rework, close, cancel.
-- ---------------------------------------------------------------------------
create function transition_order(
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
  elsif v_action = 'returned_for_rework' then
    perform _notify(v_order.assigned_technician_id, v_order.id, 'rework',
      format('%s was returned for rework: %s', v_order.order_no, btrim(p_note)));
  elsif p_to_status = 'reviewed' then
    for v_finance in select id from staff where role = 'finance' and active loop
      perform _notify(v_finance.id, v_order.id, 'reviewed',
        format('%s has been reviewed and is ready for payment verification', v_order.order_no));
    end loop;
  end if;

  return v_order;
end;
$$;

-- ---------------------------------------------------------------------------
-- submit_completion: completion record + in_progress -> job_done, atomically.
-- ---------------------------------------------------------------------------
create function submit_completion(
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
  v_extra   numeric := coalesce(p_extra_charges, 0);
  v_manager record;
begin
  perform _authorize_transition(v_actor, v_order, 'job_done', null);

  if btrim(coalesce(p_work_done, '')) = '' then
    raise exception 'Describe the work done before submitting';
  end if;
  if v_extra < 0 then
    raise exception 'Extra charges cannot be negative';
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
    select id from staff where role = 'manager' and active and branch_id = v_order.branch_id
  loop
    perform _notify(v_manager.id, v_order.id, 'job_done',
      format('%s is done and awaiting your review', v_order.order_no));
  end loop;

  return v_order;
end;
$$;

-- ---------------------------------------------------------------------------
-- record_payment
-- ---------------------------------------------------------------------------
create function record_payment(
  p_order_id uuid,
  p_amount   numeric,
  p_method   payment_method,
  p_note     text default null
) returns payments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor   staff := _require_actor();
  v_order   orders := _lock_order(p_order_id);
  v_payment payments;
begin
  if not (
    v_actor.role = 'finance'
    or (v_actor.role = 'technician' and v_order.assigned_technician_id = v_actor.id)
  ) then
    raise exception 'Only the assigned technician or Finance can record a payment';
  end if;
  if v_order.status not in ('in_progress', 'job_done', 'reviewed') then
    raise exception 'Payments can only be recorded while the order is In Progress, Job Done or Reviewed (it is currently %)',
      _status_label(v_order.status);
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Payment amount must be greater than zero';
  end if;
  if p_method is null then
    raise exception 'Select a payment method';
  end if;

  insert into payments (order_id, amount, method, note, recorded_by)
  values (v_order.id, round(p_amount, 2), p_method,
          nullif(btrim(coalesce(p_note, '')), ''), v_actor.id)
  returning * into v_payment;

  perform _audit(v_order.id, v_actor, 'payment_recorded', null, null, p_note,
    jsonb_build_object(
      'payment_id', v_payment.id,
      'amount', v_payment.amount,
      'method', v_payment.method,
      'status', v_order.status,
      'payment_status_after', _payment_status(v_order.id)));

  return v_payment;
end;
$$;

-- ---------------------------------------------------------------------------
-- reschedule_order: a log entry, never a status change.
-- ---------------------------------------------------------------------------
create function reschedule_order(
  p_order_id         uuid,
  p_new_scheduled_at timestamptz,
  p_reason           reschedule_reason,
  p_requested_by     reschedule_party,
  p_note             text default null
) returns order_reschedules
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor staff := _require_actor();
  v_order orders := _lock_order(p_order_id);
  v_entry order_reschedules;
begin
  if not (
    v_actor.role = 'admin'
    or (v_actor.role = 'technician' and v_order.assigned_technician_id = v_actor.id)
  ) then
    raise exception 'Only Admin or the assigned technician can reschedule an order';
  end if;
  if v_order.status not in ('new', 'assigned', 'acknowledged', 'in_progress') then
    raise exception 'Only an order that is not yet completed can be rescheduled (it is currently %)',
      _status_label(v_order.status);
  end if;
  if p_reason is null then
    raise exception 'Select a reason for the reschedule';
  end if;
  if p_requested_by is null then
    raise exception 'Say who requested the reschedule';
  end if;
  if p_reason = 'other' and btrim(coalesce(p_note, '')) = '' then
    raise exception 'Please describe the reason for the reschedule';
  end if;

  insert into order_reschedules (
    order_id, old_scheduled_at, new_scheduled_at, reason, reason_note, requested_by, performed_by
  ) values (
    v_order.id, v_order.scheduled_at, p_new_scheduled_at, p_reason,
    nullif(btrim(coalesce(p_note, '')), ''), p_requested_by, v_actor.id
  ) returning * into v_entry;

  update orders set scheduled_at = p_new_scheduled_at where id = v_order.id;

  perform _audit(v_order.id, v_actor, 'rescheduled', null, null, p_note,
    jsonb_build_object(
      'old_scheduled_at', v_order.scheduled_at,
      'new_scheduled_at', p_new_scheduled_at,
      'reason', p_reason,
      'requested_by', p_requested_by,
      'status', v_order.status));

  return v_entry;
end;
$$;

-- ---------------------------------------------------------------------------
-- mark_notification_read
-- ---------------------------------------------------------------------------
create function mark_notification_read(p_notification_id bigint) returns notifications
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor        staff := _require_actor();
  v_notification notifications;
begin
  select * into v_notification from notifications where id = p_notification_id for update;
  if not found then
    raise exception 'Notification not found';
  end if;
  if v_notification.recipient_id <> v_actor.id then
    raise exception 'You can only mark your own notifications as read';
  end if;
  update notifications
     set read_at = coalesce(read_at, now())
   where id = v_notification.id
   returning * into v_notification;
  return v_notification;
end;
$$;

-- ---------------------------------------------------------------------------
-- technician_jobs: a technician's job list (their own orders only).
-- ---------------------------------------------------------------------------
create function technician_jobs() returns setof order_summary
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor staff := _require_actor();
begin
  if v_actor.role <> 'technician' then
    raise exception 'Only technicians have a job list';
  end if;
  return query
    select * from order_summary
     where assigned_technician_id = v_actor.id
     order by scheduled_at nulls last, created_at;
end;
$$;

-- ---------------------------------------------------------------------------
-- current_staff: the signed-in user's active staff profile (with branch name).
-- Returns no row when signed out or when the account has no active staff
-- profile, so the app can tell the user instead of failing.
-- ---------------------------------------------------------------------------
create function current_staff()
returns table (
  id          uuid,
  name        text,
  email       text,
  phone       text,
  role        staff_role,
  branch_id   uuid,
  branch_name text,
  active      boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select s.id, s.name, s.email, s.phone, s.role, s.branch_id, b.name, s.active
    from staff s
    join branches b on b.id = s.branch_id
   where s.auth_user_id = auth.uid()
     and s.active;
$$;

-- ---------------------------------------------------------------------------
-- Lock down function execution. Postgres grants EXECUTE to PUBLIC by default;
-- revoke it so only roles granted explicitly (see the access policies
-- migration) can call the RPCs. Helpers stay internal.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind = 'f'
       and p.proname in (
         '_status_label', '_transition_phrase', '_require_actor', '_lock_order',
         '_require_technician', '_audit', '_notify', '_payment_status',
         '_authorize_transition', 'create_order', 'transition_order',
         'submit_completion', 'record_payment', 'reschedule_order',
         'mark_notification_read', 'technician_jobs', 'current_staff')
  loop
    execute format('revoke execute on function %s from public', r.sig);
  end loop;
end;
$$;
