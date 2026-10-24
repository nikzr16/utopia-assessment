-- 0001 Admin order portal: phone and price rules, order editing, list reads.
-- Builds on the 0000 rules migration; nothing here edits an earlier file.
--
-- * _normalize_my_phone / _check_quoted_price: the Malaysian phone and quoted
--   price rules. src/domain/phone.ts and src/domain/price.ts mirror them;
--   tests/db/parity.test.ts keeps both identical.
-- * create_order is replaced (same signature, so its grants stay) to store
--   phones normalised (60123456789) and to check the price range.
-- * update_order: Admin edits an order's details while it is New, Assigned or
--   Acknowledged. Audited with old and new values; the assigned technician is
--   notified. An existing scheduled date changes only through reschedule_order.
-- * list_orders / technician_options: read functions for the portal. They run
--   as the caller (security invoker), so row-level security still applies.

-- ---------------------------------------------------------------------------
-- Rules
-- ---------------------------------------------------------------------------
-- Digits with country code (60...), or an error. Accepts +60 / 60 / 0
-- prefixes and spaces, dashes, dots and brackets between digits.
create function _normalize_my_phone(p_phone text) returns text
language plpgsql immutable as $$
declare
  v_digits   text := regexp_replace(coalesce(p_phone, ''), '[[:space:]().-]', '', 'g');
  v_national text;
begin
  if v_digits = '' then
    raise exception 'Phone number is required';
  end if;
  if v_digits ~ '^\+?600?[1-9][0-9]*$' then
    -- Country code; tolerate a stray trunk 0 after it (+60 012...).
    v_national := '0' || regexp_replace(v_digits, '^\+?600?', '');
  elsif v_digits ~ '^0[0-9]+$' then
    v_national := v_digits;
  else
    raise exception 'Enter a valid Malaysian phone number, for example 012-345 6789 or 03-1234 5678';
  end if;
  if not (
       v_national ~ '^01[02346789][0-9]{7}$'  -- mobile, 7 digits after the prefix
    or v_national ~ '^01[15][0-9]{8}$'        -- mobile 011 / 015, 8 digits
    or v_national ~ '^03[0-9]{8}$'            -- landline, Klang Valley
    or v_national ~ '^0[4-79][0-9]{7}$'       -- landline, other Peninsular areas
    or v_national ~ '^08[2-9][0-9]{6}$'       -- landline, Sabah and Sarawak
  ) then
    raise exception 'Enter a valid Malaysian phone number, for example 012-345 6789 or 03-1234 5678';
  end if;
  return '60' || substr(v_national, 2);
end;
$$;

-- RM 0.00 to RM 100,000.00, at most 2 decimal places.
create function _check_quoted_price(p_price numeric) returns numeric
language plpgsql immutable as $$
begin
  if p_price is null then
    raise exception 'Quoted price is required';
  end if;
  if p_price < 0 then
    raise exception 'Quoted price must be zero or more';
  end if;
  if p_price > 100000 then
    raise exception 'Quoted price cannot be more than RM 100,000.00';
  end if;
  if p_price <> round(p_price, 2) then
    raise exception 'Quoted price can have at most 2 decimal places';
  end if;
  return p_price;
end;
$$;

-- Shared field checks for create_order and update_order. Returns the
-- normalised customer phone. p_current_service_type_id lets an edit keep a
-- service type that has since been deactivated.
create function _check_order_details(
  p_branch_id                uuid,
  p_customer_name            text,
  p_customer_phone           text,
  p_customer_address         text,
  p_problem_description      text,
  p_service_type_id          uuid,
  p_quoted_price             numeric,
  p_current_service_type_id  uuid default null
) returns text
language plpgsql as $$
declare
  v_phone text;
begin
  if btrim(coalesce(p_customer_name, '')) = '' then
    raise exception 'Customer name is required';
  end if;
  if btrim(coalesce(p_customer_phone, '')) = '' then
    raise exception 'Customer phone is required';
  end if;
  v_phone := _normalize_my_phone(p_customer_phone);
  if btrim(coalesce(p_customer_address, '')) = '' then
    raise exception 'Customer address is required';
  end if;
  if btrim(coalesce(p_problem_description, '')) = '' then
    raise exception 'Problem description is required';
  end if;
  perform _check_quoted_price(p_quoted_price);
  if not exists (select 1 from branches where id = p_branch_id) then
    raise exception 'Select a valid branch';
  end if;
  if not exists (
    select 1 from service_types
     where id = p_service_type_id
       and (active or id = p_current_service_type_id)
  ) then
    raise exception 'Select a valid service type';
  end if;
  return v_phone;
end;
$$;

-- ---------------------------------------------------------------------------
-- create_order (replaced: same signature and grants, stricter checks)
-- ---------------------------------------------------------------------------
create or replace function create_order(
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
  v_phone  text;
begin
  if v_actor.role <> 'admin' then
    raise exception 'Only Admin can create an order';
  end if;
  v_phone := _check_order_details(
    p_branch_id, p_customer_name, p_customer_phone, p_customer_address,
    p_problem_description, p_service_type_id, p_quoted_price);

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
    p_branch_id, btrim(p_customer_name), v_phone, btrim(p_customer_address),
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
-- update_order: edit details (never status or technician)
-- ---------------------------------------------------------------------------
alter table notifications drop constraint notifications_event_check;
alter table notifications add constraint notifications_event_check
  check (event in ('assigned', 'job_done', 'rework', 'reviewed', 'order_updated'));

create function update_order(
  p_order_id            uuid,
  p_expected_updated_at timestamptz,
  p_branch_id           uuid,
  p_customer_name       text,
  p_customer_phone      text,
  p_customer_address    text,
  p_problem_description text,
  p_service_type_id     uuid,
  p_quoted_price        numeric,
  p_scheduled_at        timestamptz default null,
  p_admin_notes         text default null
) returns orders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor   staff := _require_actor();
  v_old     orders;
  v_new     orders;
  v_changes jsonb := '{}'::jsonb;
  v_labels  text[] := '{}';
begin
  if v_actor.role <> 'admin' then
    raise exception 'Only Admin can edit an order';
  end if;
  v_old := _lock_order(p_order_id);
  if v_old.status not in ('new', 'assigned', 'acknowledged') then
    raise exception 'An order can only be edited while it is New, Assigned or Acknowledged (it is currently %)',
      _status_label(v_old.status);
  end if;
  -- Compared to the millisecond: browsers keep timestamps at that precision.
  if p_expected_updated_at is null
     or date_trunc('milliseconds', p_expected_updated_at) <> date_trunc('milliseconds', v_old.updated_at) then
    raise exception 'This order was changed by someone else. Reload to see the latest version.';
  end if;

  v_new := v_old;
  v_new.customer_phone := _check_order_details(
    p_branch_id, p_customer_name, p_customer_phone, p_customer_address,
    p_problem_description, p_service_type_id, p_quoted_price, v_old.service_type_id);
  v_new.branch_id := p_branch_id;
  v_new.customer_name := btrim(p_customer_name);
  v_new.customer_address := btrim(p_customer_address);
  v_new.problem_description := btrim(p_problem_description);
  v_new.service_type_id := p_service_type_id;
  v_new.quoted_price := p_quoted_price;
  v_new.admin_notes := nullif(btrim(coalesce(p_admin_notes, '')), '');
  v_new.scheduled_at := p_scheduled_at;

  -- A date that is already set moves only through reschedule_order, so every
  -- move has a reason and lands in the reschedule log.
  if v_old.scheduled_at is not null and v_new.scheduled_at is distinct from v_old.scheduled_at then
    raise exception 'Use Reschedule to change a scheduled date';
  end if;

  if v_new.branch_id is distinct from v_old.branch_id then
    v_changes := v_changes || jsonb_build_object('branch', jsonb_build_object(
      'from', (select name from branches where id = v_old.branch_id),
      'to',   (select name from branches where id = v_new.branch_id)));
    v_labels := array_append(v_labels, 'branch');
  end if;
  if v_new.customer_name is distinct from v_old.customer_name then
    v_changes := v_changes || jsonb_build_object('customer_name', jsonb_build_object(
      'from', v_old.customer_name, 'to', v_new.customer_name));
    v_labels := array_append(v_labels, 'customer name');
  end if;
  if v_new.customer_phone is distinct from v_old.customer_phone then
    v_changes := v_changes || jsonb_build_object('customer_phone', jsonb_build_object(
      'from', v_old.customer_phone, 'to', v_new.customer_phone));
    v_labels := array_append(v_labels, 'phone');
  end if;
  if v_new.customer_address is distinct from v_old.customer_address then
    v_changes := v_changes || jsonb_build_object('customer_address', jsonb_build_object(
      'from', v_old.customer_address, 'to', v_new.customer_address));
    v_labels := array_append(v_labels, 'address');
  end if;
  if v_new.problem_description is distinct from v_old.problem_description then
    v_changes := v_changes || jsonb_build_object('problem_description', jsonb_build_object(
      'from', v_old.problem_description, 'to', v_new.problem_description));
    v_labels := array_append(v_labels, 'problem description');
  end if;
  if v_new.service_type_id is distinct from v_old.service_type_id then
    v_changes := v_changes || jsonb_build_object('service_type', jsonb_build_object(
      'from', (select name from service_types where id = v_old.service_type_id),
      'to',   (select name from service_types where id = v_new.service_type_id)));
    v_labels := array_append(v_labels, 'service type');
  end if;
  if v_new.quoted_price is distinct from v_old.quoted_price then
    v_changes := v_changes || jsonb_build_object('quoted_price', jsonb_build_object(
      'from', v_old.quoted_price, 'to', v_new.quoted_price));
    v_labels := array_append(v_labels, 'quoted price');
  end if;
  if v_new.scheduled_at is distinct from v_old.scheduled_at then
    v_changes := v_changes || jsonb_build_object('scheduled_at', jsonb_build_object(
      'from', v_old.scheduled_at, 'to', v_new.scheduled_at));
    v_labels := array_append(v_labels, 'scheduled date');
  end if;
  if v_new.admin_notes is distinct from v_old.admin_notes then
    v_changes := v_changes || jsonb_build_object('admin_notes', jsonb_build_object(
      'from', v_old.admin_notes, 'to', v_new.admin_notes));
    v_labels := array_append(v_labels, 'admin notes');
  end if;

  -- Nothing changed: nothing to write.
  if v_changes = '{}'::jsonb then
    return v_old;
  end if;

  update orders
     set branch_id           = v_new.branch_id,
         customer_name       = v_new.customer_name,
         customer_phone      = v_new.customer_phone,
         customer_address    = v_new.customer_address,
         problem_description = v_new.problem_description,
         service_type_id     = v_new.service_type_id,
         quoted_price        = v_new.quoted_price,
         scheduled_at        = v_new.scheduled_at,
         admin_notes         = v_new.admin_notes
   where id = v_old.id
   returning * into v_new;

  perform _audit(v_new.id, v_actor, 'updated', null, null, null,
    jsonb_build_object('changes', v_changes, 'status', v_new.status));

  if v_new.assigned_technician_id is not null then
    perform _notify(v_new.assigned_technician_id, v_new.id, 'order_updated',
      format('%s was updated: %s', v_new.order_no, array_to_string(v_labels, ', ')));
  end if;

  return v_new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reads (security invoker: row-level security applies to the caller)
-- ---------------------------------------------------------------------------
-- One page of orders, newest first, with the total number of matches.
-- Search matches order number or customer name (case-insensitive) and, when
-- the search has 3+ digits, the customer phone.
create function list_orders(
  p_search         text default null,
  p_statuses       order_status[] default null,
  p_branch_id      uuid default null,
  p_technician_id  uuid default null,
  p_scheduled_from timestamptz default null,
  p_scheduled_to   timestamptz default null,
  p_limit          integer default 25,
  p_offset         integer default 0
) returns table (
  id                     uuid,
  order_no               text,
  status                 order_status,
  branch_id              uuid,
  branch_name            text,
  customer_name          text,
  customer_phone         text,
  service_type_name      text,
  quoted_price           numeric,
  assigned_technician_id uuid,
  technician_name        text,
  scheduled_at           timestamptz,
  created_at             timestamptz,
  total_count            bigint
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with params as (
    select
      -- Search text with LIKE wildcards escaped.
      nullif(replace(replace(replace(btrim(coalesce(p_search, '')), '\', '\\'), '%', '\%'), '_', '\_'), '') as text_q,
      -- Phone search on the digits typed. Typed with a trunk 0 or country code
      -- (012-345, +60 12 345) it matches from the start of the number;
      -- otherwise (6789) anywhere in it.
      case
        when regexp_replace(coalesce(p_search, ''), '[^0-9]', '', 'g') ~ '^(60|0)'
        then '60' || regexp_replace(regexp_replace(p_search, '[^0-9]', '', 'g'), '^(60|0)', '') || '%'
        else '%' || regexp_replace(coalesce(p_search, ''), '[^0-9]', '', 'g') || '%'
      end as phone_q,
      length(regexp_replace(coalesce(p_search, ''), '[^0-9]', '', 'g')) as digit_count
  )
  select
    s.id, s.order_no, s.status, s.branch_id, s.branch_name, s.customer_name,
    s.customer_phone, s.service_type_name, s.quoted_price, s.assigned_technician_id,
    s.technician_name, s.scheduled_at, s.created_at,
    count(*) over () as total_count
  from order_summary s, params p
  where (p.text_q is null
         or s.order_no ilike '%' || p.text_q || '%'
         or s.customer_name ilike '%' || p.text_q || '%'
         or (p.digit_count >= 3 and s.customer_phone like p.phone_q))
    and (p_statuses is null or cardinality(p_statuses) = 0 or s.status = any (p_statuses))
    and (p_branch_id is null or s.branch_id = p_branch_id)
    and (p_technician_id is null or s.assigned_technician_id = p_technician_id)
    and (p_scheduled_from is null or s.scheduled_at >= p_scheduled_from)
    and (p_scheduled_to is null or s.scheduled_at < p_scheduled_to)
  order by s.created_at desc, s.order_no desc
  limit least(greatest(coalesce(p_limit, 25), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

-- Active technicians for the assign dropdown, with their open-job count
-- (Assigned, Acknowledged, In Progress).
create function technician_options() returns table (
  id          uuid,
  name        text,
  phone       text,
  branch_id   uuid,
  branch_name text,
  open_jobs   bigint
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select s.id, s.name, s.phone, s.branch_id, b.name,
         (select count(*)
            from orders o
           where o.assigned_technician_id = s.id
             and o.status in ('assigned', 'acknowledged', 'in_progress'))
    from staff s
    join branches b on b.id = s.branch_id
   where s.role = 'technician'
     and s.active
   order by b.name, s.name;
$$;

-- ---------------------------------------------------------------------------
-- Execute privileges: helpers internal, new RPCs for signed-in staff only.
-- (create_order keeps the grants it already had.)
-- ---------------------------------------------------------------------------
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
         '_normalize_my_phone', '_check_quoted_price', '_check_order_details',
         'update_order', 'list_orders', 'technician_options')
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', r.sig);
    if r.proname in ('update_order', 'list_orders', 'technician_options') then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;
