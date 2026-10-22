-- 0000 System foundation: row-level security and grants.
--
-- Access model
--   * Only signed-in staff with an ACTIVE staff profile can read anything
--     (role `authenticated`). `anon` (signed-out visitors) gets nothing.
--   * Technicians read only the orders assigned to them, and the rows hanging
--     off those orders. Every other active staff member reads all orders
--     (branch-based restriction is out of scope). Notifications are readable by
--     their recipient only.
--   * Nobody gets direct write access. Every change goes through the SECURITY
--     DEFINER RPCs, which resolve the actor from auth.uid() and enforce the rules.
--   * `service_role` (the login script) may read staff and call
--     link_staff_accounts(); nothing else.
--
-- The hosted project has "Automatically expose new tables" turned off, so every
-- privilege the app needs is granted explicitly below. Supabase's default
-- privileges may still hand out access on new objects, so everything is first
-- revoked and then granted back minimally.

do $$
begin
  if exists (
    select 1 from unnest(array['anon', 'authenticated', 'service_role']) as r(name)
     where not exists (select 1 from pg_roles where rolname = r.name)
  ) then
    raise exception 'Supabase roles anon, authenticated and service_role are required';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Policy helpers: the signed-in user's active staff id / role (null otherwise).
-- SECURITY DEFINER so they can read staff regardless of staff's own policy.
-- ---------------------------------------------------------------------------
create function _current_staff_id() returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select id from staff where auth_user_id = auth.uid() and active;
$$;

create function _current_staff_role() returns staff_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select role from staff where auth_user_id = auth.uid() and active;
$$;

-- ---------------------------------------------------------------------------
-- Row-level security on every table
-- ---------------------------------------------------------------------------
alter table branches                 enable row level security;
alter table staff                    enable row level security;
alter table service_types            enable row level security;
alter table orders                   enable row level security;
alter table order_completions        enable row level security;
alter table attachments              enable row level security;
alter table payments                 enable row level security;
alter table order_reschedules        enable row level security;
alter table audit_log                enable row level security;
alter table notifications            enable row level security;
alter table order_status_transitions enable row level security;

-- Reference data: any active staff member.
create policy branches_read on branches
  for select to authenticated
  using (_current_staff_id() is not null);

create policy service_types_read on service_types
  for select to authenticated
  using (_current_staff_id() is not null);

create policy order_status_transitions_read on order_status_transitions
  for select to authenticated
  using (_current_staff_id() is not null);

create policy staff_read on staff
  for select to authenticated
  using (_current_staff_id() is not null);

-- Orders: non-technicians see all; technicians only their own.
create policy orders_read on orders
  for select to authenticated
  using (
    _current_staff_role() is not null
    and (_current_staff_role() <> 'technician' or assigned_technician_id = _current_staff_id())
  );

-- Everything that hangs off an order follows that order's visibility. The
-- subquery on orders is itself subject to the orders policy above.
create policy order_completions_read on order_completions
  for select to authenticated
  using (exists (select 1 from orders o where o.id = order_completions.order_id));

create policy attachments_read on attachments
  for select to authenticated
  using (exists (select 1 from orders o where o.id = attachments.order_id));

create policy payments_read on payments
  for select to authenticated
  using (exists (select 1 from orders o where o.id = payments.order_id));

create policy order_reschedules_read on order_reschedules
  for select to authenticated
  using (exists (select 1 from orders o where o.id = order_reschedules.order_id));

create policy audit_log_read on audit_log
  for select to authenticated
  using (exists (select 1 from orders o where o.id = audit_log.order_id));

-- Notifications: the recipient only.
create policy notifications_read on notifications
  for select to authenticated
  using (recipient_id = _current_staff_id());

-- ---------------------------------------------------------------------------
-- Grants. Start from nothing, then grant back only what is needed.
-- ---------------------------------------------------------------------------
revoke all on all tables    in schema public from public, anon, authenticated, service_role;
revoke all on all sequences in schema public from public, anon, authenticated, service_role;
revoke all on all functions in schema public from public, anon, authenticated, service_role;

grant usage on schema public to authenticated, service_role;

-- Signed-in staff: read the tables (RLS narrows the rows) and the summary view.
-- order_summary is security_invoker, so the policies above apply through it.
grant select on
  branches, staff, service_types, orders, order_completions, attachments,
  payments, order_reschedules, audit_log, notifications, order_status_transitions,
  order_summary
  to authenticated;

-- The RPCs, the profile lookup, and the helpers the policies call.
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
         'create_order', 'transition_order', 'submit_completion', 'record_payment',
         'reschedule_order', 'mark_notification_read', 'technician_jobs',
         'current_staff', '_current_staff_id', '_current_staff_role')
  loop
    execute format('grant execute on function %s to authenticated', r.sig);
  end loop;
end;
$$;

-- Service role (login script): read staff, and link accounts to staff.
grant select on staff to service_role;
grant execute on function link_staff_accounts() to service_role;

-- anon: nothing. (Everything was revoked above; no grants and no policies.)
