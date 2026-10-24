-- 0000 System foundation: schema.
-- Standard Postgres plus one Supabase dependency: staff.auth_user_id references
-- auth.users, which Supabase provides (the database tests create a small shim).
-- Sign-in linking lives in 20261022000003_auth_link.sql; row-level security and
-- grants live in 20261022000004_access_policies.sql.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type staff_role as enum ('admin', 'technician', 'manager', 'finance');

create type order_status as enum (
  'new', 'assigned', 'acknowledged', 'in_progress',
  'job_done', 'reviewed', 'closed', 'cancelled'
);

create type payment_method as enum ('cash', 'bank_transfer', 'card', 'ewallet');

create type reschedule_reason as enum (
  'customer_not_home', 'parts_unavailable', 'weather',
  'technician_unavailable', 'other'
);

create type reschedule_party as enum ('customer', 'technician', 'admin');

create type attachment_kind as enum ('photo', 'video', 'pdf');

-- ---------------------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------------------
create table branches (
  id   uuid primary key default gen_random_uuid(),
  name text not null unique
);

-- A staff member signs in through Supabase Auth. auth_user_id is filled in by
-- the link trigger (see the auth link migration) when an account with the same
-- email exists; it is null until then.
create table staff (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  email        text not null check (btrim(email) <> ''),
  phone        text not null,
  role         staff_role not null,
  branch_id    uuid not null references branches (id),
  active       boolean not null default true,
  auth_user_id uuid unique references auth.users (id) on delete set null
);

-- Email is unique regardless of letter case.
create unique index staff_email_key on staff (lower(email));
create index staff_role_idx on staff (role);
create index staff_branch_idx on staff (branch_id);

create table service_types (
  id     uuid primary key default gen_random_uuid(),
  name   text not null unique,
  active boolean not null default true
);

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------
-- Order numbers read ORDER1001, ORDER1002, ...
create sequence order_no_seq start with 1001 minvalue 1001;

create table orders (
  id                     uuid primary key default gen_random_uuid(),
  order_no               text not null unique default ('ORDER' || nextval('order_no_seq')::text),
  branch_id              uuid not null references branches (id),
  customer_name          text not null,
  customer_phone         text not null,
  customer_address       text not null,
  problem_description    text not null,
  service_type_id        uuid not null references service_types (id),
  quoted_price           numeric(12, 2) not null check (quoted_price >= 0),
  assigned_technician_id uuid references staff (id),
  admin_notes            text,
  status                 order_status not null default 'new',
  scheduled_at           timestamptz,
  created_by             uuid not null references staff (id),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  -- A new order has no technician; every live or finished order has one.
  constraint orders_technician_matches_status check (
    (status = 'new' and assigned_technician_id is null)
    or status = 'cancelled'
    or (status not in ('new', 'cancelled') and assigned_technician_id is not null)
  )
);

create index orders_status_idx on orders (status);
create index orders_technician_idx on orders (assigned_technician_id);
create index orders_branch_idx on orders (branch_id);
create index orders_scheduled_idx on orders (scheduled_at);

-- order_no can never change; updated_at is maintained automatically.
create function orders_guard() returns trigger
language plpgsql as $$
begin
  if new.order_no is distinct from old.order_no then
    raise exception 'Order number cannot be changed';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger orders_guard_trg
  before update on orders
  for each row execute function orders_guard();

-- ---------------------------------------------------------------------------
-- Completion, payments, attachments, reschedules
-- ---------------------------------------------------------------------------
create table order_completions (
  order_id      uuid primary key references orders (id) on delete cascade,
  work_done     text not null,
  extra_charges numeric(12, 2) not null default 0 check (extra_charges >= 0),
  remarks       text,
  technician_id uuid not null references staff (id),
  completed_at  timestamptz not null default now()
);

create table payments (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references orders (id) on delete cascade,
  amount      numeric(12, 2) not null check (amount > 0),
  method      payment_method not null,
  note        text,
  recorded_by uuid not null references staff (id),
  recorded_at timestamptz not null default now()
);

create index payments_order_idx on payments (order_id);

-- payment_id is null for completion attachments, set for receipt photos.
create table attachments (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references orders (id) on delete cascade,
  payment_id   uuid references payments (id) on delete cascade,
  kind         attachment_kind not null,
  storage_path text not null,
  mime_type    text,
  uploaded_by  uuid not null references staff (id),
  created_at   timestamptz not null default now()
);

create index attachments_order_idx on attachments (order_id);

-- At most 6 completion attachments (payment_id is null) per order.
create function attachments_limit() returns trigger
language plpgsql as $$
declare
  v_count integer;
begin
  if new.payment_id is null then
    -- Serialise concurrent inserts for the same order.
    perform 1 from orders where id = new.order_id for update;
    select count(*) into v_count
      from attachments
     where order_id = new.order_id
       and payment_id is null
       and id <> new.id;
    if v_count >= 6 then
      raise exception 'An order can have at most 6 completion attachments';
    end if;
  end if;
  return new;
end;
$$;

create trigger attachments_limit_trg
  before insert or update of order_id, payment_id on attachments
  for each row execute function attachments_limit();

create table order_reschedules (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references orders (id) on delete cascade,
  old_scheduled_at timestamptz,
  new_scheduled_at timestamptz, -- null = postponed with no new date
  reason           reschedule_reason not null,
  reason_note      text,
  requested_by     reschedule_party not null,
  performed_by     uuid not null references staff (id),
  created_at       timestamptz not null default now()
);

create index order_reschedules_order_idx on order_reschedules (order_id);

-- ---------------------------------------------------------------------------
-- Audit log and notifications
-- ---------------------------------------------------------------------------
create table audit_log (
  id          bigint generated always as identity primary key,
  order_id    uuid not null references orders (id) on delete cascade,
  actor_id    uuid not null references staff (id),
  actor_role  staff_role not null,
  action      text not null,
  from_status order_status,
  to_status   order_status,
  note        text,
  details     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index audit_log_order_idx on audit_log (order_id, id);

-- The audit trail is append-only.
create function audit_log_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'The audit log cannot be changed';
end;
$$;

create trigger audit_log_no_update_trg
  before update or delete on audit_log
  for each row execute function audit_log_append_only();

create table notifications (
  id           bigint generated always as identity primary key,
  recipient_id uuid not null references staff (id),
  order_id     uuid not null references orders (id) on delete cascade,
  event        text not null check (event in ('assigned', 'job_done', 'rework', 'reviewed')),
  message      text not null,
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);

create index notifications_recipient_idx on notifications (recipient_id, read_at);

-- ---------------------------------------------------------------------------
-- Derived money: nothing stores a total that could drift.
-- ---------------------------------------------------------------------------
create view order_summary with (security_invoker = true) as
select
  x.*,
  greatest(x.final_amount - x.amount_paid, 0)::numeric(12, 2) as balance,
  greatest(x.amount_paid - x.final_amount, 0)::numeric(12, 2) as overpaid_amount,
  case
    when x.amount_paid >= x.final_amount then 'paid'
    when x.amount_paid <= 0 then 'unpaid'
    else 'partial'
  end as payment_status
from (
  select
    o.id,
    o.order_no,
    o.branch_id,
    o.customer_name,
    o.customer_phone,
    o.customer_address,
    o.problem_description,
    o.service_type_id,
    o.quoted_price,
    o.assigned_technician_id,
    o.admin_notes,
    o.status,
    o.scheduled_at,
    o.created_by,
    o.created_at,
    o.updated_at,
    st.name as service_type_name,
    t.name  as technician_name,
    b.name  as branch_name,
    coalesce(c.extra_charges, 0)::numeric(12, 2) as extra_charges,
    (o.quoted_price + coalesce(c.extra_charges, 0))::numeric(12, 2) as final_amount,
    coalesce((select sum(p.amount) from payments p where p.order_id = o.id), 0)::numeric(12, 2) as amount_paid
  from orders o
  join branches b on b.id = o.branch_id
  join service_types st on st.id = o.service_type_id
  left join staff t on t.id = o.assigned_technician_id
  left join order_completions c on c.order_id = o.id
) x;
