-- 0007 KPI dashboard (docs/prd/0007-kpi-dashboard-prd.md,
-- docs/plan/0007-kpi-dashboard-plan.md).
-- Builds on 0000-0006; nothing here edits an earlier file. Nothing is written
-- by the dashboard: every number is computed when the page loads.
--
-- * order_reschedules.technician_id: the technician assigned when the
--   reschedule was logged (null while the order had none). A before-insert
--   trigger fills it from the order; existing rows are backfilled from the
--   audit trail (the assignment in force at that time), else the order's
--   current technician when the order has no assignment history at all.
-- * Indexes for the period queries (approval, return, reschedule, payment,
--   staff history).
-- * Five read functions, the only door the dashboard (and later the AI
--   assistant, 0008) uses. Each is security definer, stable, takes the actor
--   from the session (_require_actor) and returns only what the role may
--   see: Admin and Finance every branch; a Manager the branches they cover
--   (another branch is refused); a technician only their own numbers (no
--   rank, no other names, no branch comparison).
--     kpi_summary            one row of cards for a period and branch
--     kpi_technicians        the leaderboard: one row per listed technician
--     kpi_branches           one row per visible branch (comparison)
--     kpi_trend              one row per week / month
--     kpi_technician_events  the rows behind a technician's numbers
--   Inputs and outputs are written in `comment on function` below.
-- * Definitions (one place each, in the private _kpi_* helpers):
--     Jobs completed   orders now Reviewed or Closed, on the day (Malaysia
--                      time) of the `reviewed` audit entry; credited to the
--                      technician of the completion record
--     Total amount     quoted price + extra charges of those jobs
--     Collected        payments by recorded_at; credited to the completion
--                      technician, else the assigned technician
--     Rescheduled /    order_reschedules rows by created_at (new date given /
--     Postponed        no date); credited to order_reschedules.technician_id
--     Returned         `returned_for_rework` audit entries by created_at;
--                      credited to the order's technician
--     Rated, average,  latest feedback of each counted job (the order page's
--     poor             rule); credited to the technician stored on the visit
--     Active techs     staff_history intervals (technician, active, branch)
--   Every job, reschedule, payment and return counts in the order's branch.
--
-- src/domain/kpi.ts mirrors the pure rules (week / month start, ranking,
-- needs attention); tests/db/parity.test.ts keeps both identical.

-- ---------------------------------------------------------------------------
-- The technician of a reschedule
-- ---------------------------------------------------------------------------
alter table order_reschedules add column technician_id uuid references staff (id);

update order_reschedules r
   set technician_id = case
     when exists (
            select 1 from audit_log a
             where a.order_id = r.order_id and a.action in ('created', 'assigned', 'reassigned'))
       then (select coalesce(a.details ->> 'new_technician_id', a.details ->> 'technician_id')::uuid
               from audit_log a
              where a.order_id = r.order_id
                and a.action in ('created', 'assigned', 'reassigned')
                and a.created_at <= r.created_at
              order by a.id desc
              limit 1)
     else (select o.assigned_technician_id from orders o where o.id = r.order_id)
   end;

create function order_reschedules_technician() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.technician_id is null then
    select o.assigned_technician_id into new.technician_id
      from orders o where o.id = new.order_id;
  end if;
  return new;
end;
$$;

create trigger order_reschedules_technician_trg
  before insert on order_reschedules
  for each row execute function order_reschedules_technician();

create index order_reschedules_technician_idx on order_reschedules (technician_id, created_at);

-- ---------------------------------------------------------------------------
-- Indexes for the period queries
-- (customer_feedback (order_id, created_at desc) exists since 0005.)
-- ---------------------------------------------------------------------------
create index audit_log_reviewed_idx on audit_log (created_at) where action = 'reviewed';
create index audit_log_returned_idx on audit_log (created_at) where action = 'returned_for_rework';
create index order_reschedules_created_idx on order_reschedules (created_at);
create index payments_recorded_idx on payments (recorded_at);
create index staff_history_staff_created_idx on staff_history (staff_id, created_at);

-- ---------------------------------------------------------------------------
-- Private helpers
-- ---------------------------------------------------------------------------
-- A Malaysia calendar day (UTC+8) as the instant it starts.
create function _kpi_day_start(p_day date) returns timestamptz
language sql immutable as $$
  select (p_day::timestamp - interval '8 hours') at time zone 'UTC';
$$;

-- A period of Malaysia days [p_start, p_end) as instants; refuses a missing,
-- empty, backwards or longer-than-400-day period.
create function _kpi_period(p_start date, p_end date) returns table (t_from timestamptz, t_to timestamptz)
language plpgsql immutable as $$
begin
  if p_start is null or p_end is null or not isfinite(p_start) or not isfinite(p_end) then
    raise exception 'Choose a start and an end date';
  end if;
  if p_end <= p_start then
    raise exception 'The period must end after it starts';
  end if;
  if p_end - p_start > 400 then
    raise exception 'Choose a period of up to a year';
  end if;
  return query select _kpi_day_start(p_start), _kpi_day_start(p_end);
end;
$$;

-- The branches the actor may read, narrowed to one when asked: Admin and
-- Finance every branch, a Manager the branches they cover (a branch they do
-- not cover is refused), a technician every branch (their own rows only are
-- ever counted; see the technician filter in each function).
create function _kpi_visible_branches(p_actor staff, p_branch_id uuid) returns uuid[]
language plpgsql stable as $$
declare
  v_branches uuid[];
begin
  if p_actor.role not in ('admin', 'finance', 'manager', 'technician') then
    raise exception 'You cannot see the dashboard';
  end if;
  if p_branch_id is not null then
    if p_actor.role = 'manager' and not _covers_branch(p_actor, p_branch_id) then
      raise exception 'You can only see the branches you cover';
    end if;
    if not exists (select 1 from branches b where b.id = p_branch_id) then
      raise exception 'Branch not found';
    end if;
    return array[p_branch_id];
  end if;
  select coalesce(array_agg(b.id order by b.name), '{}') into v_branches
    from branches b
   where p_actor.role <> 'manager' or _covers_branch(p_actor, b.id);
  return v_branches;
end;
$$;

-- 3 or more returns for rework in the period: "Needs attention"
-- (src/domain/review.ts NEEDS_ATTENTION_RETURNS).
create function _kpi_needs_attention(p_returned integer) returns boolean
language sql immutable as $$
  select coalesce(p_returned, 0) >= 3;
$$;

-- Jobs completed: approved (Reviewed) in [p_from, p_to), still Reviewed or
-- Closed. One row per order. technician_id = who submitted the approved work;
-- rating_technician_id = the technician stored on the visit's rating.
create function _kpi_completed_jobs(p_from timestamptz, p_to timestamptz, p_branches uuid[])
returns table (
  order_id              uuid,
  order_no              text,
  branch_id             uuid,
  service_type          text,
  technician_id         uuid,
  rating_technician_id  uuid,
  happened_at           timestamptz,
  amount                numeric,
  rating                smallint,
  working_well          boolean
)
language sql stable as $$
  select o.id, o.order_no, o.branch_id, st.name,
         coalesce(c.technician_id, o.assigned_technician_id),
         coalesce(fb.technician_id, c.technician_id, o.assigned_technician_id),
         a.created_at,
         (o.quoted_price + coalesce(c.extra_charges, 0))::numeric(12, 2),
         fb.rating,
         fb.working_well
    from audit_log a
    join orders o on o.id = a.order_id
    join service_types st on st.id = o.service_type_id
    left join order_completions c on c.order_id = o.id
    left join lateral (
      select f.technician_id, f.rating, f.working_well
        from customer_feedback f
        join customer_messages fm on fm.id = f.message_id
       where f.order_id = o.id
       order by fm.created_at desc, fm.id desc
       limit 1) fb on true
   where a.action = 'reviewed'
     and a.created_at >= p_from and a.created_at < p_to
     and o.status in ('reviewed', 'closed')
     and o.branch_id = any (p_branches)
     and not exists (
       select 1 from audit_log n
        where n.order_id = a.order_id and n.action = 'reviewed' and n.id > a.id);
$$;

-- Every counted event of the period, one row each. kind: completed,
-- rescheduled, postponed, returned, payment. technician_id is who gets the
-- credit (null: nobody, e.g. a reschedule before the order had a technician).
create function _kpi_events(p_from timestamptz, p_to timestamptz, p_branches uuid[])
returns table (
  kind                  text,
  order_id              uuid,
  order_no              text,
  branch_id             uuid,
  service_type          text,
  technician_id         uuid,
  rating_technician_id  uuid,
  happened_at           timestamptz,
  amount                numeric,
  rating                smallint,
  working_well          boolean,
  reason                text,
  requested_by          text,
  note                  text
)
language sql stable as $$
  select 'completed', j.order_id, j.order_no, j.branch_id, j.service_type, j.technician_id,
         j.rating_technician_id, j.happened_at, j.amount, j.rating, j.working_well,
         null::text, null::text, null::text
    from _kpi_completed_jobs(p_from, p_to, p_branches) j
  union all
  select case when r.new_scheduled_at is null then 'postponed' else 'rescheduled' end,
         o.id, o.order_no, o.branch_id, st.name, r.technician_id, null::uuid, r.created_at,
         null::numeric, null::smallint, null::boolean,
         r.reason::text, r.requested_by::text, r.reason_note
    from order_reschedules r
    join orders o on o.id = r.order_id
    join service_types st on st.id = o.service_type_id
   where r.created_at >= p_from and r.created_at < p_to
     and o.branch_id = any (p_branches)
  union all
  select 'returned', o.id, o.order_no, o.branch_id, st.name, o.assigned_technician_id, null::uuid,
         a.created_at, null::numeric, null::smallint, null::boolean,
         null::text, null::text, a.note
    from audit_log a
    join orders o on o.id = a.order_id
    join service_types st on st.id = o.service_type_id
   where a.action = 'returned_for_rework'
     and a.created_at >= p_from and a.created_at < p_to
     and o.branch_id = any (p_branches)
  union all
  select 'payment', o.id, o.order_no, o.branch_id, st.name,
         coalesce(c.technician_id, o.assigned_technician_id), null::uuid, p.recorded_at,
         p.amount, null::smallint, null::boolean,
         null::text, null::text, null::text
    from payments p
    join orders o on o.id = p.order_id
    join service_types st on st.id = o.service_type_id
    left join order_completions c on c.order_id = o.id
   where p.recorded_at >= p_from and p.recorded_at < p_to
     and o.branch_id = any (p_branches);
$$;

-- Technicians who were active in one of the branches at some time in
-- [p_from, p_to) (staff_history intervals), and whether each was still active
-- there at the period's end. One row per (technician, branch).
create function _kpi_active_technicians(p_from timestamptz, p_to timestamptz, p_branches uuid[])
returns table (staff_id uuid, branch_id uuid, active_at_end boolean)
language sql stable as $$
  with h as (
    select sh.staff_id, sh.role, sh.branch_id, sh.active, sh.created_at as a,
           lead(sh.created_at) over (partition by sh.staff_id order by sh.created_at, sh.id) as b
      from staff_history sh
     where sh.created_at < p_to
  )
  select h.staff_id, h.branch_id,
         bool_or(coalesce(h.b, 'infinity'::timestamptz) >= p_to)
    from h
   where h.role = 'technician' and h.active
     and h.branch_id = any (p_branches)
     and (h.b is null or (h.b > h.a and h.b > p_from))
   group by h.staff_id, h.branch_id;
$$;

-- The numbers of a period, grouped. p_group: 'technician' (by credited
-- technician; ratings by the visit's technician), 'branch' (by the order's
-- branch) or 'all' (one row, group_id null; no row when nothing was counted).
-- reason_by_requester is filled for 'all' only.
-- p_tech narrows to one technician's own credit. Every figure on every screen
-- comes through here.
create function _kpi_metrics(
  p_from     timestamptz,
  p_to       timestamptz,
  p_branches uuid[],
  p_tech     uuid,
  p_group    text
) returns table (
  group_id                      uuid,
  jobs_completed                integer,
  total_amount                  numeric,
  collected                     numeric,
  rescheduled                   integer,
  postponed                     integer,
  requested_by_customer         integer,
  requested_by_technician       integer,
  requested_by_admin            integer,
  reason_customer_not_home      integer,
  reason_parts_unavailable      integer,
  reason_weather                integer,
  reason_technician_unavailable integer,
  reason_other                  integer,
  reason_by_requester           jsonb,
  returned                      integer,
  rated                         integer,
  average_rating                numeric,
  poor_ratings                  integer
)
language sql stable as $$
  with ev as (
    select e.*,
           case p_group when 'technician' then e.technician_id when 'branch' then e.branch_id end as gk,
           case p_group when 'technician' then e.rating_technician_id when 'branch' then e.branch_id end as rk
      from _kpi_events(p_from, p_to, p_branches) e
  ),
  own as (
    select * from ev where p_tech is null or ev.technician_id = p_tech
  ),
  rated_jobs as (
    select * from ev
     where ev.kind = 'completed' and ev.rating is not null
       and (p_tech is null or ev.rating_technician_id = p_tech)
  ),
  s as (
    select o.gk as k,
           (o.kind = 'completed')::integer as jobs,
           case when o.kind = 'completed' then o.amount else 0 end as amt,
           case when o.kind = 'payment' then o.amount else 0 end as col,
           (o.kind = 'rescheduled')::integer as resc,
           (o.kind = 'postponed')::integer as post,
           (o.requested_by = 'customer')::integer as rq_customer,
           (o.requested_by = 'technician')::integer as rq_technician,
           (o.requested_by = 'admin')::integer as rq_admin,
           (o.reason = 'customer_not_home')::integer as r_not_home,
           (o.reason = 'parts_unavailable')::integer as r_parts,
           (o.reason = 'weather')::integer as r_weather,
           (o.reason = 'technician_unavailable')::integer as r_tech,
           (o.reason = 'other')::integer as r_other,
           (o.kind = 'returned')::integer as ret,
           0 as rated,
           0 as stars,
           0 as poor
      from own o
    union all
    select r.rk, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
           1, r.rating::integer,
           case when _is_low_feedback(r.rating, r.working_well) then 1 else 0 end
      from rated_jobs r
  ),
  rc as (
    select o.gk as k, o.reason, o.requested_by, count(*)::integer as n
      from own o
     where o.kind in ('rescheduled', 'postponed')
       and p_group = 'all'
     group by o.gk, o.reason, o.requested_by
  ),
  m as (
    select s.k,
           sum(s.jobs)::integer as jobs,
           sum(s.amt)::numeric(12, 2) as amt,
           sum(s.col)::numeric(12, 2) as col,
           sum(s.resc)::integer as resc,
           sum(s.post)::integer as post,
           sum(s.rq_customer)::integer as rq_customer,
           sum(s.rq_technician)::integer as rq_technician,
           sum(s.rq_admin)::integer as rq_admin,
           sum(s.r_not_home)::integer as r_not_home,
           sum(s.r_parts)::integer as r_parts,
           sum(s.r_weather)::integer as r_weather,
           sum(s.r_tech)::integer as r_tech,
           sum(s.r_other)::integer as r_other,
           sum(s.ret)::integer as ret,
           sum(s.rated)::integer as rated,
           sum(s.stars) as stars,
           sum(s.poor)::integer as poor
      from s
     group by s.k
  )
  select m.k, m.jobs, m.amt, m.col, m.resc, m.post,
         m.rq_customer, m.rq_technician, m.rq_admin,
         m.r_not_home, m.r_parts, m.r_weather, m.r_tech, m.r_other,
         case when p_group = 'all' then
           (select jsonb_object_agg(rs.reason,
                     (select jsonb_object_agg(rq.party,
                               (select coalesce(sum(rc.n), 0)::integer from rc
                                 where rc.k is not distinct from m.k
                                   and rc.reason = rs.reason and rc.requested_by = rq.party))
                        from unnest(array['customer', 'technician', 'admin']) as rq(party)))
              from unnest(array['customer_not_home', 'parts_unavailable', 'weather',
                                'technician_unavailable', 'other']) as rs(reason))
         end,
         m.ret, m.rated,
         case when m.rated > 0 then round(m.stars::numeric / m.rated, 1) end,
         m.poor
    from m;
$$;

-- ---------------------------------------------------------------------------
-- The five read functions
-- ---------------------------------------------------------------------------
create function kpi_summary(p_start date, p_end date, p_branch_id uuid default null)
returns table (
  jobs_completed                integer,
  total_amount                  numeric,
  collected                     numeric,
  rescheduled                   integer,
  postponed                     integer,
  requested_by_customer         integer,
  requested_by_technician       integer,
  requested_by_admin            integer,
  reason_customer_not_home      integer,
  reason_parts_unavailable      integer,
  reason_weather                integer,
  reason_technician_unavailable integer,
  reason_other                  integer,
  reason_by_requester           jsonb,
  returned                      integer,
  rated                         integer,
  average_rating                numeric,
  poor_ratings                  integer,
  active_technicians            integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_actor    staff := _require_actor();
  v_from     timestamptz;
  v_to       timestamptz;
  v_branches uuid[];
  v_tech     uuid;
begin
  select p.t_from, p.t_to into v_from, v_to from _kpi_period(p_start, p_end) p;
  v_branches := _kpi_visible_branches(v_actor, p_branch_id);
  v_tech := case when v_actor.role = 'technician' then v_actor.id end;
  return query
    select coalesce(m.jobs_completed, 0), coalesce(m.total_amount, 0)::numeric,
           coalesce(m.collected, 0)::numeric, coalesce(m.rescheduled, 0), coalesce(m.postponed, 0),
           coalesce(m.requested_by_customer, 0), coalesce(m.requested_by_technician, 0),
           coalesce(m.requested_by_admin, 0), coalesce(m.reason_customer_not_home, 0),
           coalesce(m.reason_parts_unavailable, 0), coalesce(m.reason_weather, 0),
           coalesce(m.reason_technician_unavailable, 0), coalesce(m.reason_other, 0),
           coalesce(m.reason_by_requester, (
             select jsonb_object_agg(rs.reason, jsonb_build_object('customer', 0, 'technician', 0, 'admin', 0))
               from unnest(array['customer_not_home', 'parts_unavailable', 'weather',
                                 'technician_unavailable', 'other']) as rs(reason))),
           coalesce(m.returned, 0), coalesce(m.rated, 0), m.average_rating, coalesce(m.poor_ratings, 0),
           (select count(distinct a.staff_id)::integer
              from _kpi_active_technicians(v_from, v_to, v_branches) a
             where a.active_at_end and (v_tech is null or a.staff_id = v_tech))
      from (select 1) d
      left join _kpi_metrics(v_from, v_to, v_branches, v_tech, 'all') m on true;
end;
$$;

create function kpi_technicians(p_start date, p_end date, p_branch_id uuid default null)
returns table (
  id                            uuid,
  name                          text,
  active                        boolean,
  branch_id                     uuid,
  branch_name                   text,
  jobs_completed                integer,
  total_amount                  numeric,
  collected                     numeric,
  rescheduled                   integer,
  postponed                     integer,
  reschedules                   integer,
  requested_by_customer         integer,
  requested_by_technician       integer,
  requested_by_admin            integer,
  reason_customer_not_home      integer,
  reason_parts_unavailable      integer,
  reason_weather                integer,
  reason_technician_unavailable integer,
  reason_other                  integer,
  returned                      integer,
  rated                         integer,
  average_rating                numeric,
  poor_ratings                  integer,
  rank                          integer,
  needs_attention               boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_actor    staff := _require_actor();
  v_from     timestamptz;
  v_to       timestamptz;
  v_branches uuid[];
  v_tech     uuid;
begin
  select p.t_from, p.t_to into v_from, v_to from _kpi_period(p_start, p_end) p;
  v_branches := _kpi_visible_branches(v_actor, p_branch_id);
  v_tech := case when v_actor.role = 'technician' then v_actor.id end;
  return query
    with m as (
      select * from _kpi_metrics(v_from, v_to, v_branches, v_tech, 'technician') x
       where x.group_id is not null
    ),
    listed as (
      select a.staff_id as sid
        from _kpi_active_technicians(v_from, v_to, v_branches) a
       where v_tech is null or a.staff_id = v_tech
      union
      select m.group_id from m
      union
      select v_tech where v_tech is not null
    ),
    r as (
      select s.id as sid, s.name as sname, s.active as sactive, s.branch_id as sbranch, b.name as bname,
             coalesce(m.jobs_completed, 0) as jobs, coalesce(m.total_amount, 0)::numeric as amt,
             coalesce(m.collected, 0)::numeric as col,
             coalesce(m.rescheduled, 0) as resc, coalesce(m.postponed, 0) as post,
             coalesce(m.requested_by_customer, 0) as rq_c, coalesce(m.requested_by_technician, 0) as rq_t,
             coalesce(m.requested_by_admin, 0) as rq_a,
             coalesce(m.reason_customer_not_home, 0) as r_nh, coalesce(m.reason_parts_unavailable, 0) as r_pu,
             coalesce(m.reason_weather, 0) as r_w, coalesce(m.reason_technician_unavailable, 0) as r_tu,
             coalesce(m.reason_other, 0) as r_o,
             coalesce(m.returned, 0) as ret, coalesce(m.rated, 0) as rated, m.average_rating as avg_rating,
             coalesce(m.poor_ratings, 0) as poor
        from listed l
        join staff s on s.id = l.sid
        join branches b on b.id = s.branch_id
        left join m on m.group_id = s.id
    )
    select r.sid, r.sname, r.sactive, r.sbranch, r.bname,
           r.jobs, r.amt, r.col, r.resc, r.post, r.resc + r.post,
           r.rq_c, r.rq_t, r.rq_a, r.r_nh, r.r_pu, r.r_w, r.r_tu, r.r_o,
           r.ret, r.rated, r.avg_rating, r.poor,
           case when v_tech is null then (rank() over (order by r.jobs desc, r.amt desc))::integer end,
           _kpi_needs_attention(r.ret)
      from r
     order by r.jobs desc, r.amt desc, lower(r.sname), r.sid;
end;
$$;

create function kpi_branches(p_start date, p_end date)
returns table (
  branch_id          uuid,
  branch_name        text,
  jobs_completed     integer,
  total_amount       numeric,
  collected          numeric,
  rescheduled        integer,
  postponed          integer,
  reschedules        integer,
  returned           integer,
  rated              integer,
  average_rating     numeric,
  poor_ratings       integer,
  active_technicians integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_actor    staff := _require_actor();
  v_from     timestamptz;
  v_to       timestamptz;
  v_branches uuid[];
begin
  if v_actor.role = 'technician' then
    raise exception 'The branch comparison is not available to technicians';
  end if;
  select p.t_from, p.t_to into v_from, v_to from _kpi_period(p_start, p_end) p;
  v_branches := _kpi_visible_branches(v_actor, null);
  return query
    with m as (
      select * from _kpi_metrics(v_from, v_to, v_branches, null, 'branch') x
    ),
    act as (
      select a.branch_id as bid, count(distinct a.staff_id)::integer as n
        from _kpi_active_technicians(v_from, v_to, v_branches) a
       where a.active_at_end
       group by a.branch_id
    )
    select b.id, b.name,
           coalesce(m.jobs_completed, 0), coalesce(m.total_amount, 0)::numeric,
           coalesce(m.collected, 0)::numeric, coalesce(m.rescheduled, 0), coalesce(m.postponed, 0),
           coalesce(m.rescheduled, 0) + coalesce(m.postponed, 0),
           coalesce(m.returned, 0), coalesce(m.rated, 0), m.average_rating,
           coalesce(m.poor_ratings, 0), coalesce(act.n, 0)
      from branches b
      left join m on m.group_id = b.id
      left join act on act.bid = b.id
     where b.id = any (v_branches)
     order by b.name;
end;
$$;

create function kpi_trend(
  p_unit          text,
  p_end           date,
  p_count         integer,
  p_branch_id     uuid default null,
  p_technician_id uuid default null
) returns table (
  period_start   date,
  period_end     date,
  jobs_completed integer,
  total_amount   numeric,
  reschedules    integer,
  average_rating numeric
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_actor    staff := _require_actor();
  v_branches uuid[];
  v_tech     uuid;
  v_step     interval;
  v_last     date;
  v_first    date;
begin
  if p_unit is null or p_unit not in ('week', 'month') then
    raise exception 'Choose week or month';
  end if;
  if p_end is null or not isfinite(p_end) then
    raise exception 'Choose an end date';
  end if;
  if p_count is null or p_count < 1 or p_count > 26 then
    raise exception 'Choose between 1 and 26 periods';
  end if;
  if v_actor.role = 'technician' then
    if p_technician_id is not null and p_technician_id <> v_actor.id then
      raise exception 'You can only see your own numbers';
    end if;
    v_tech := v_actor.id;
  else
    v_tech := p_technician_id;
    if v_tech is not null and not exists (select 1 from staff s where s.id = v_tech) then
      raise exception 'Technician not found';
    end if;
  end if;
  v_branches := _kpi_visible_branches(v_actor, p_branch_id);
  v_step := case p_unit when 'week' then interval '1 week' else interval '1 month' end;
  -- Whole Monday-Sunday weeks / calendar months; the last one holds the day
  -- before p_end (p_end is exclusive, like every other period).
  v_last := date_trunc(p_unit, (p_end - 1)::timestamp)::date;
  v_first := (v_last::timestamp - v_step * (p_count - 1))::date;
  return query
    select d.d::date, (d.d + v_step)::date,
           coalesce(m.jobs_completed, 0), coalesce(m.total_amount, 0)::numeric,
           coalesce(m.rescheduled, 0) + coalesce(m.postponed, 0), m.average_rating
      from generate_series(v_first::timestamp, v_last::timestamp, v_step) as d(d)
      left join lateral _kpi_metrics(
        _kpi_day_start(d.d::date), _kpi_day_start((d.d + v_step)::date), v_branches, v_tech, 'all') m on true
     order by d.d;
end;
$$;

create function kpi_technician_events(
  p_technician_id uuid,
  p_start         date,
  p_end           date,
  p_branch_id     uuid default null
) returns table (
  kind         text,
  order_id     uuid,
  order_no     text,
  service_type text,
  branch_id    uuid,
  branch_name  text,
  happened_at  timestamptz,
  amount       numeric,
  rating       smallint,
  working_well boolean,
  reason       text,
  requested_by text,
  note         text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_actor    staff := _require_actor();
  v_from     timestamptz;
  v_to       timestamptz;
  v_branches uuid[];
begin
  if v_actor.role = 'technician' and p_technician_id is distinct from v_actor.id then
    raise exception 'You can only see your own numbers';
  end if;
  if p_technician_id is null or not exists (select 1 from staff s where s.id = p_technician_id) then
    raise exception 'Technician not found';
  end if;
  select p.t_from, p.t_to into v_from, v_to from _kpi_period(p_start, p_end) p;
  v_branches := _kpi_visible_branches(v_actor, p_branch_id);
  return query
    select e.kind, e.order_id, e.order_no, e.service_type, e.branch_id, b.name, e.happened_at, e.amount,
           case when e.kind = 'completed' and e.rating_technician_id = p_technician_id then e.rating end,
           case when e.kind = 'completed' and e.rating_technician_id = p_technician_id then e.working_well end,
           e.reason, e.requested_by, e.note
      from _kpi_events(v_from, v_to, v_branches) e
      join branches b on b.id = e.branch_id
     where e.kind <> 'payment' and e.technician_id = p_technician_id
     order by e.happened_at desc, e.order_no, e.kind;
end;
$$;

-- ---------------------------------------------------------------------------
-- Documentation for the read functions (inputs and outputs), so the AI
-- assistant (0008) can whitelist them as they are.
-- ---------------------------------------------------------------------------
comment on function kpi_summary(date, date, uuid) is
'KPI cards for a period. Inputs: p_start and p_end are Malaysia calendar days, p_end exclusive (a week is Monday to the next Monday, a month the 1st to the next 1st); the period must end after it starts and be at most 400 days; p_branch_id optionally narrows to one branch (a Manager may only ask for a branch they cover). Scope: Admin and Finance every branch, a Manager the branches they cover, a technician only their own numbers. Output, one row: jobs_completed (jobs a Manager approved in the period and still Reviewed or Closed), total_amount (final amount = quoted price + extra charges of those jobs, MYR), collected (payments recorded in the period), rescheduled (log rows with a new date), postponed (log rows without a date), requested_by_customer / requested_by_technician / requested_by_admin and reason_customer_not_home / reason_parts_unavailable / reason_weather / reason_technician_unavailable / reason_other (each counts rescheduled + postponed rows), reason_by_requester (json: reason -> requested by -> count), returned (returns for rework logged in the period), rated (counted jobs with a rating, latest rating per order), average_rating (1 to 5, 1 decimal, null when nothing is rated), poor_ratings (1-2 stars or not working well), active_technicians (technicians active in the scope at the end of the period).';

comment on function kpi_technicians(date, date, uuid) is
'Technician leaderboard. Inputs: as kpi_summary (p_start, p_end exclusive Malaysia days, optional p_branch_id; same scope). Output, one row per listed technician (everyone who was an active technician in the scope at any time in the period, plus anyone with a counted event there; zero rows show 0), best first: id, name, active (now), branch_id / branch_name (home branch now), jobs_completed, total_amount, collected, rescheduled, postponed, reschedules (rescheduled + postponed), requested_by_* and reason_* counts as kpi_summary, returned, rated, average_rating, poor_ratings, rank (competition rank by jobs_completed then total_amount, equal values share a rank: 1, 1, 3; null for a technician caller, who gets only their own row), needs_attention (3 or more returns in the period). Order: jobs_completed desc, total_amount desc, name.';

comment on function kpi_branches(date, date) is
'Branch comparison. Inputs: p_start, p_end exclusive Malaysia days (at most 400 days). Scope: Admin and Finance every branch, a Manager the branches they cover; technicians are refused. Output, one row per visible branch by name (branches with nothing show 0): branch_id, branch_name, jobs_completed, total_amount, collected, rescheduled, postponed, reschedules, returned, rated, average_rating, poor_ratings, active_technicians (at the end of the period). Same definitions as kpi_summary.';

comment on function kpi_trend(text, date, integer, uuid, uuid) is
'Trend over whole weeks or months. Inputs: p_unit ''week'' (Monday to Sunday) or ''month'' (calendar month); p_end an exclusive Malaysia day: the last row is the week or month holding the day before p_end; p_count 1 to 26 rows; p_branch_id optional branch (scope as kpi_summary); p_technician_id optional technician (a technician caller may only ask for themselves). Output, oldest first, one row per period (also when nothing happened): period_start, period_end (exclusive), jobs_completed, total_amount, reschedules (rescheduled + postponed), average_rating (null when nothing is rated). Same definitions as kpi_summary.';

comment on function kpi_technician_events(uuid, date, date, uuid) is
'The rows behind one technician''s numbers. Inputs: p_technician_id (a technician caller may only ask for themselves); p_start, p_end exclusive Malaysia days; optional p_branch_id; scope as kpi_summary (rows outside it are not returned). Output, latest first: kind (completed, rescheduled, postponed, returned), order_id, order_no, service_type, branch_id, branch_name, happened_at (approval, reschedule or return time), amount (final amount, completed only), rating and working_well (completed only, the latest rating when it belongs to this technician), reason and requested_by (rescheduled / postponed), note (reschedule note or return note).';

-- ---------------------------------------------------------------------------
-- Privileges: the five read functions for signed-in staff only (the function
-- scopes the rows); the helpers and the trigger function are internal.
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
         'order_reschedules_technician', '_kpi_day_start', '_kpi_period', '_kpi_visible_branches',
         '_kpi_needs_attention', '_kpi_completed_jobs', '_kpi_events', '_kpi_active_technicians',
         '_kpi_metrics', 'kpi_summary', 'kpi_technicians', 'kpi_branches', 'kpi_trend',
         'kpi_technician_events')
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', r.sig);
    if r.proname like 'kpi\_%' then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end;
$$;
