-- 0008 AI operations query (docs/prd/0008-ai-ops-query-prd.md,
-- docs/plan/0008-ai-ops-query-plan.md).
-- Builds on 0000-0007; nothing here edits an earlier file.
--
-- The `ask` Edge Function lets the AI choose lookups from a fixed menu: the
-- five 0007 kpi_* functions and the three read functions below. Every lookup
-- runs as the person asking, so the database decides what they may see:
--   ask_jobs          jobs by technician, branch, status, customer, payment
--                     status, and scheduled / Job Done / approved / created /
--                     closed date
--   ask_payments      payments recorded, receipts not verified yet, and
--                     unpaid / partly paid jobs
--   ask_find_people   forgiving name search (pg_trgm) among the people the
--                     caller may ask about; marks the one clear match
-- ask_jobs and ask_payments are security invoker: they read the
-- security_invoker views, so the row-level security of 0000-0004 applies
-- (Managers their covered branches, technicians their own orders). The
-- branch / period checks and their plain-language refusals come from
-- _ask_scope, the same rules as the KPI functions.
--
-- Saved chats and the Admin Question log:
--   ask_chats, ask_messages   a person reads only their own
--   ask_log                   Admins read every entry (no answers, no rows)
--   Everything is kept 7 days: reads hide older rows and ask_purge_old()
--   deletes them nightly (pg_cron where available).
-- Only the Edge Function writes them (ask_record, service_role only), so no
-- one can plant a chat answer or a log entry from the browser. People rename
-- and delete their own chats with ask_rename_chat / ask_delete_chat.

-- ---------------------------------------------------------------------------
-- Name matching: pg_trgm in the `extensions` schema (Supabase's default).
-- ---------------------------------------------------------------------------
create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------
-- Scope: the caller's visible branches and the period as instants, with the
-- KPI refusals ("You can only see the branches you cover", period errors).
-- A technician may ask only about themselves. Granted to signed-in staff: it
-- reveals nothing beyond the caller's own branch list.
-- ---------------------------------------------------------------------------
create function _ask_scope(
  p_branch_id     uuid,
  p_technician_id uuid,
  p_start         date,
  p_end           date
) returns table (branches uuid[], t_from timestamptz, t_to timestamptz)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor staff := _require_actor();
  v_from  timestamptz;
  v_to    timestamptz;
begin
  if v_actor.role = 'technician' and p_technician_id is not null and p_technician_id <> v_actor.id then
    raise exception 'You can only see your own jobs';
  end if;
  if p_technician_id is not null and not exists (select 1 from staff s where s.id = p_technician_id) then
    raise exception 'Technician not found';
  end if;
  if p_start is not null or p_end is not null then
    select p.t_from, p.t_to into v_from, v_to from _kpi_period(p_start, p_end) p;
  end if;
  return query select _kpi_visible_branches(v_actor, p_branch_id), v_from, v_to;
end;
$$;

-- LIKE pattern for "contains", with the wildcards in the text escaped.
create function _ask_contains_pattern(p_text text) returns text
language sql immutable as $$
  select '%' || replace(replace(replace(btrim(p_text), '\', '\\'), '%', '\%'), '_', '\_') || '%';
$$;

-- ---------------------------------------------------------------------------
-- ask_jobs
-- ---------------------------------------------------------------------------
create function ask_jobs(
  p_technician_id  uuid    default null,
  p_branch_id      uuid    default null,
  p_statuses       text[]  default null,
  p_customer_name  text    default null,
  p_payment_status text    default null,
  p_date_kind      text    default null,
  p_start          date    default null,
  p_end            date    default null,
  p_limit          integer default 50
) returns table (
  order_id           uuid,
  order_no           text,
  status             text,
  service_type       text,
  branch_id          uuid,
  branch_name        text,
  technician_id      uuid,
  technician_name    text,
  technician_active  boolean,
  customer_name      text,
  customer_phone     text,
  customer_address   text,
  scheduled_at       timestamptz,
  created_at         timestamptz,
  job_done_at        timestamptz,
  approved_at        timestamptz,
  closed_at          timestamptz,
  final_amount       numeric,
  amount_paid        numeric,
  balance            numeric,
  payment_status     text,
  rating             smallint,
  return_count       integer,
  total_count        integer
)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_scope record;
begin
  if p_date_kind is not null and p_date_kind not in ('scheduled', 'job_done', 'approved', 'created', 'closed') then
    raise exception 'Unknown date kind: %', p_date_kind;
  end if;
  if (p_date_kind is null) <> (p_start is null and p_end is null) then
    raise exception 'Choose a date kind together with a period';
  end if;
  if p_statuses is not null and exists (
       select 1 from unnest(p_statuses) x
        where x not in (select unnest(enum_range(null::order_status))::text)) then
    raise exception 'Unknown status';
  end if;
  if p_payment_status is not null and p_payment_status not in ('unpaid', 'partial', 'paid') then
    raise exception 'Unknown payment status: %', p_payment_status;
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 200 then
    raise exception 'Choose between 1 and 200 rows';
  end if;
  if p_customer_name is not null and btrim(p_customer_name) = '' then
    raise exception 'Type part of the customer name';
  end if;

  select * into v_scope from _ask_scope(p_branch_id, p_technician_id, p_start, p_end);

  return query
    with j as (
      select s.*,
             coalesce(s.completion_technician_id, s.assigned_technician_id) as tech_id,
             case p_date_kind
               when 'scheduled' then s.scheduled_at
               when 'job_done'  then s.completed_at
               when 'approved'  then s.reviewed_at
               when 'created'   then s.created_at
               when 'closed'    then s.closed_at
             end as at
        from order_review_summary s
       where s.branch_id = any (v_scope.branches)
         and (p_statuses is null or s.status::text = any (p_statuses))
         and (p_customer_name is null
              or s.customer_name ilike _ask_contains_pattern(p_customer_name))
         and (p_payment_status is null or s.payment_status = p_payment_status)
         -- An approval counts while the job is Reviewed or Closed (0007).
         and (p_date_kind is distinct from 'approved' or s.status in ('reviewed', 'closed'))
    )
    select j.id, j.order_no, j.status::text, j.service_type_name, j.branch_id, j.branch_name,
           j.tech_id, t.name, t.active,
           j.customer_name, j.customer_phone, j.customer_address,
           j.scheduled_at, j.created_at, j.completed_at, j.reviewed_at, j.closed_at,
           j.final_amount, j.amount_paid, j.balance, j.payment_status,
           j.latest_rating, j.return_count,
           (count(*) over ())::integer
      from j
      left join staff t on t.id = j.tech_id
     where (p_technician_id is null or j.tech_id = p_technician_id)
       and (p_date_kind is null or (j.at >= v_scope.t_from and j.at < v_scope.t_to))
     order by
       case when p_date_kind = 'scheduled' then j.at end asc nulls last,
       case when p_date_kind is not null and p_date_kind <> 'scheduled' then j.at end desc nulls last,
       j.created_at desc,
       j.order_no
     limit p_limit;
end;
$$;

-- ---------------------------------------------------------------------------
-- ask_payments
-- ---------------------------------------------------------------------------
create function ask_payments(
  p_kind          text,
  p_start         date    default null,
  p_end           date    default null,
  p_branch_id     uuid    default null,
  p_technician_id uuid    default null,
  p_limit         integer default 50
) returns table (
  kind            text,
  order_id        uuid,
  order_no        text,
  status          text,
  branch_id       uuid,
  branch_name     text,
  technician_id   uuid,
  technician_name text,
  customer_name   text,
  payment_id      uuid,
  amount          numeric,
  method          text,
  recorded_at     timestamptz,
  verified_at     timestamptz,
  job_done_at     timestamptz,
  final_amount    numeric,
  amount_paid     numeric,
  balance         numeric,
  payment_status  text,
  total_count     integer
)
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_scope record;
begin
  if p_kind is null or p_kind not in ('recorded', 'unverified', 'unpaid', 'partly_paid') then
    raise exception 'Unknown payment question: %', coalesce(p_kind, 'none');
  end if;
  if p_kind = 'recorded' and (p_start is null or p_end is null) then
    raise exception 'Choose a start and an end date';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 200 then
    raise exception 'Choose between 1 and 200 rows';
  end if;

  select * into v_scope from _ask_scope(p_branch_id, p_technician_id, p_start, p_end);

  if p_kind in ('recorded', 'unverified') then
    return query
      select p_kind, s.id, s.order_no, s.status::text, s.branch_id, s.branch_name,
             coalesce(s.completion_technician_id, s.assigned_technician_id), t.name, s.customer_name,
             p.id, p.amount, p.method::text, p.recorded_at, p.verified_at, s.completed_at,
             s.final_amount, s.amount_paid, s.balance, s.payment_status,
             (count(*) over ())::integer
        from payments p
        join order_review_summary s on s.id = p.order_id
        left join staff t on t.id = coalesce(s.completion_technician_id, s.assigned_technician_id)
       where s.branch_id = any (v_scope.branches)
         and (p_technician_id is null
              or coalesce(s.completion_technician_id, s.assigned_technician_id) = p_technician_id)
         and (v_scope.t_from is null or (p.recorded_at >= v_scope.t_from and p.recorded_at < v_scope.t_to))
         and (p_kind = 'recorded' or (p.method <> 'cash' and p.verified_at is null))
       order by p.recorded_at desc, s.order_no
       limit p_limit;
  else
    -- Money still owed on finished work: Job Done or Reviewed (Closed needs full
    -- payment). The period, when given, is the Job Done day.
    return query
      select p_kind, s.id, s.order_no, s.status::text, s.branch_id, s.branch_name,
             coalesce(s.completion_technician_id, s.assigned_technician_id), t.name, s.customer_name,
             null::uuid, null::numeric, null::text, null::timestamptz, null::timestamptz, s.completed_at,
             s.final_amount, s.amount_paid, s.balance, s.payment_status,
             (count(*) over ())::integer
        from order_review_summary s
        left join staff t on t.id = coalesce(s.completion_technician_id, s.assigned_technician_id)
       where s.branch_id = any (v_scope.branches)
         and s.status in ('job_done', 'reviewed')
         and s.payment_status = case p_kind when 'unpaid' then 'unpaid' else 'partial' end
         and (p_technician_id is null
              or coalesce(s.completion_technician_id, s.assigned_technician_id) = p_technician_id)
         and (v_scope.t_from is null or (s.completed_at >= v_scope.t_from and s.completed_at < v_scope.t_to))
       order by s.balance desc, s.completed_at, s.order_no
       limit p_limit;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- ask_find_people
-- ---------------------------------------------------------------------------
-- A name for matching: lower case, punctuation as spaces, titles and
-- patronymic words dropped ("Encik Ali bin Abu" → "ali abu").
create function _ask_normalize_name(p_name text) returns text
language sql immutable as $$
  select coalesce(array_to_string(array(
    select w
      from unnest(regexp_split_to_array(
             btrim(regexp_replace(lower(coalesce(p_name, '')), '[^a-z0-9/]+', ' ', 'g')), ' ')) w
     where w <> ''
       and w not in ('bin', 'binti', 'bt', 'b', 'a/l', 'a/p', 'al', 'ap', 'encik', 'en', 'puan', 'pn',
                     'cik', 'mr', 'mrs', 'ms', 'miss', 'dr', 'tuan')), ' '), '');
$$;

-- How close a typed name is to a stored one, 0-1.
create function _ask_name_score(p_name text, p_query text) returns numeric
language plpgsql immutable
set search_path = public, extensions, pg_temp
as $$
declare
  v_n text := _ask_normalize_name(p_name);
  v_q text := _ask_normalize_name(p_query);
begin
  if v_q = '' or v_n = '' then
    return 0;
  end if;
  if v_n = v_q then
    return 1;
  end if;
  if v_q = any (string_to_array(v_n, ' ')) then
    return 0.95;
  end if;
  if v_n like v_q || '%' then
    return 0.9;
  end if;
  return round(greatest(similarity(v_n, v_q), word_similarity(v_q, v_n))::numeric, 2);
end;
$$;

create function ask_find_people(p_name text, p_role text default 'technician')
returns table (
  id          uuid,
  name        text,
  role        text,
  branch_id   uuid,
  branch_name text,
  active      boolean,
  score       numeric,
  is_pick     boolean
)
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
#variable_conflict use_column
declare
  v_actor    staff := _require_actor();
  v_branches uuid[];
begin
  if p_name is null or _ask_normalize_name(p_name) = '' then
    raise exception 'Type a name to search for';
  end if;
  if p_role is null or p_role not in ('technician', 'manager', 'admin', 'finance', 'any') then
    raise exception 'Unknown role: %', coalesce(p_role, 'none');
  end if;
  v_branches := _kpi_visible_branches(v_actor, null);

  return query
    with visible as (
      select s.*
        from staff s
       where (p_role = 'any' or s.role::text = p_role)
         and case v_actor.role
               when 'technician' then s.id = v_actor.id
               when 'manager' then
                 s.branch_id = any (v_branches)
                 or exists (select 1 from staff_history h
                             where h.staff_id = s.id and h.branch_id = any (v_branches))
               else true
             end
    ),
    scored as (
      select v.id, v.name, v.role::text as role, v.branch_id, b.name as branch_name, v.active,
             _ask_name_score(v.name, p_name) as score
        from visible v
        join branches b on b.id = v.branch_id
    ),
    ranked as (
      select sc.*,
             row_number() over (order by sc.score desc, sc.active desc, sc.name) as rn,
             lead(sc.score) over (order by sc.score desc, sc.active desc, sc.name) as next_score
        from scored sc
       where sc.score >= 0.4
    )
    select r.id, r.name, r.role, r.branch_id, r.branch_name, r.active, r.score,
           (r.rn = 1 and r.score >= 0.5 and (r.next_score is null or r.next_score < r.score - 0.15))
      from ranked r
     where r.rn <= 8
     order by r.rn;
end;
$$;

-- ---------------------------------------------------------------------------
-- Saved chats and the Question log
-- ---------------------------------------------------------------------------
create table ask_chats (
  id         uuid primary key default gen_random_uuid(),
  staff_id   uuid not null references staff (id) on delete cascade,
  title      text not null check (char_length(btrim(title)) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ask_chats_staff_idx on ask_chats (staff_id, updated_at desc);

create table ask_messages (
  id         bigint generated always as identity primary key,
  chat_id    uuid not null references ask_chats (id) on delete cascade,
  role       text not null check (role in ('user', 'assistant')),
  body       text not null,
  -- The assistant's table rows, "How I found this" and lookup details, so an
  -- old chat re-opens as it was shown.
  result     jsonb,
  created_at timestamptz not null default now()
);
create index ask_messages_chat_idx on ask_messages (chat_id, id);
create index ask_messages_created_idx on ask_messages (created_at);

create table ask_log (
  id            bigint generated always as identity primary key,
  staff_id      uuid not null references staff (id) on delete cascade,
  chat_id       uuid references ask_chats (id) on delete set null,
  question      text not null,
  lookups       jsonb not null default '[]'::jsonb,
  row_count     integer,
  outcome       text not null check (outcome in (
                  'answered', 'no_data', 'clarify', 'out_of_scope', 'cannot_change', 'refused',
                  'not_found', 'ai_unavailable', 'not_set_up', 'timeout', 'error')),
  duration_ms   integer,
  input_tokens  integer,
  output_tokens integer,
  created_at    timestamptz not null default now()
);
create index ask_log_created_idx on ask_log (created_at desc);
create index ask_log_staff_idx on ask_log (staff_id, created_at desc);

alter table ask_chats    enable row level security;
alter table ask_messages enable row level security;
alter table ask_log      enable row level security;

-- Own chats only, and nothing older than 7 days.
create policy ask_chats_read on ask_chats
  for select to authenticated
  using (staff_id = _current_staff_id() and updated_at > now() - interval '7 days');

create policy ask_messages_read on ask_messages
  for select to authenticated
  using (
    created_at > now() - interval '7 days'
    and exists (select 1 from ask_chats c where c.id = ask_messages.chat_id));

-- The Question log: Admins only, nothing older than 7 days.
create policy ask_log_read on ask_log
  for select to authenticated
  using (_current_staff_role() = 'admin' and created_at > now() - interval '7 days');

-- The Admin Question log with names (RLS of ask_log applies).
create view ask_log_entries with (security_invoker = true) as
select l.id, l.created_at, l.staff_id, s.name as staff_name, s.role::text as staff_role,
       b.name as branch_name, s.active as staff_active, l.chat_id, l.question, l.lookups,
       l.row_count, l.outcome, l.duration_ms, l.input_tokens, l.output_tokens
  from ask_log l
  join staff s on s.id = l.staff_id
  join branches b on b.id = s.branch_id;

-- Rename one of your own chats.
create function ask_rename_chat(p_chat_id uuid, p_title text) returns ask_chats
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor staff := _require_actor();
  v_chat  ask_chats;
begin
  if p_title is null or char_length(btrim(p_title)) = 0 then
    raise exception 'Type a name for the chat';
  end if;
  if char_length(btrim(p_title)) > 80 then
    raise exception 'Keep the chat name to 80 characters';
  end if;
  update ask_chats set title = btrim(p_title)
   where id = p_chat_id and staff_id = v_actor.id and updated_at > now() - interval '7 days'
  returning * into v_chat;
  if not found then
    raise exception 'Chat not found';
  end if;
  return v_chat;
end;
$$;

-- Delete one of your own chats (its Question log entries stay until they
-- are 7 days old).
create function ask_delete_chat(p_chat_id uuid) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor staff := _require_actor();
begin
  delete from ask_chats where id = p_chat_id and staff_id = v_actor.id;
  if not found then
    raise exception 'Chat not found';
  end if;
end;
$$;

-- The Edge Function's record of one question (service_role only): the log
-- entry always; the question and answer in the person's chat when p_save
-- (a new chat when p_chat_id is null, titled from the question).
create function ask_record(
  p_staff_id      uuid,
  p_chat_id       uuid,
  p_question      text,
  p_answer        text,
  p_result        jsonb,
  p_save          boolean,
  p_lookups       jsonb,
  p_row_count     integer,
  p_outcome       text,
  p_duration_ms   integer,
  p_input_tokens  integer,
  p_output_tokens integer
) returns table (chat_id uuid, message_id bigint)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_chat    uuid := p_chat_id;
  v_message bigint;
  v_title   text;
begin
  if not exists (select 1 from staff s where s.id = p_staff_id and s.active) then
    raise exception 'No active staff member %', p_staff_id;
  end if;
  if p_question is null or btrim(p_question) = '' then
    raise exception 'The question is empty';
  end if;
  if v_chat is not null and not exists (
       select 1 from ask_chats c
        where c.id = v_chat and c.staff_id = p_staff_id and c.updated_at > now() - interval '7 days') then
    raise exception 'Chat not found';
  end if;

  if p_save then
    if p_answer is null or btrim(p_answer) = '' then
      raise exception 'The answer is empty';
    end if;
    if v_chat is null then
      v_title := btrim(regexp_replace(btrim(p_question), '\s+', ' ', 'g'));
      if char_length(v_title) > 60 then
        v_title := btrim(left(v_title, 59)) || '…';
      end if;
      insert into ask_chats (staff_id, title) values (p_staff_id, v_title) returning id into v_chat;
    else
      update ask_chats set updated_at = now() where id = v_chat;
    end if;
    insert into ask_messages (chat_id, role, body) values (v_chat, 'user', btrim(p_question));
    insert into ask_messages (chat_id, role, body, result)
      values (v_chat, 'assistant', p_answer, p_result)
      returning id into v_message;
  end if;

  insert into ask_log (staff_id, chat_id, question, lookups, row_count, outcome, duration_ms,
                       input_tokens, output_tokens)
  values (p_staff_id, v_chat, btrim(p_question), coalesce(p_lookups, '[]'::jsonb), p_row_count,
          p_outcome, p_duration_ms, p_input_tokens, p_output_tokens);

  return query select v_chat, v_message;
end;
$$;

-- Delete chats, messages and log entries older than 7 days (nightly).
create function ask_purge_old() returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from ask_log where created_at <= now() - interval '7 days';
  delete from ask_messages where created_at <= now() - interval '7 days';
  delete from ask_chats where updated_at <= now() - interval '7 days';
end;
$$;

-- Nightly at 03:00 Malaysia time (19:00 UTC) where pg_cron exists (Supabase;
-- enable it under Database → Extensions first). Skipped elsewhere (PGlite).
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('ask-purge-old', '0 19 * * *', 'select public.ask_purge_old()');
  end if;
end;
$$;

comment on function ask_jobs(uuid, uuid, text[], text, text, text, date, date, integer) is
  'AI lookup job_list. Inputs: technician id, branch id, statuses, part of a customer name, payment status (unpaid / partial / paid), date kind (scheduled / job_done / approved / created / closed) with a Malaysia-day period [start, end), limit 1-200. Rows the caller may read (RLS), newest first (scheduled: soonest first), with total_count.';
comment on function ask_payments(text, date, date, uuid, uuid, integer) is
  'AI lookup payment_list. kind: recorded (payments recorded in the period), unverified (non-cash receipts not verified; period optional), unpaid / partly_paid (Job Done or Reviewed jobs owing money; period = Job Done day, optional). Optional branch and technician; limit 1-200; total_count.';
comment on function ask_find_people(text, text) is
  'AI lookup find_people. Forgiving name search among the people the caller may ask about (technician: only themselves). Up to 8 candidates with a 0-1 score; is_pick marks one clear match.';

-- ---------------------------------------------------------------------------
-- Privileges
-- * authenticated: the three lookups, _ask_scope (they call it as the
--   caller), rename / delete chat, and read the chat and log tables (RLS).
-- * service_role (the ask Edge Function's secret key): ask_record and
--   ask_purge_old only.
-- ---------------------------------------------------------------------------
revoke all on ask_chats, ask_messages, ask_log, ask_log_entries from public, anon, authenticated, service_role;
grant select on ask_chats, ask_messages, ask_log, ask_log_entries to authenticated;
revoke all on sequence ask_messages_id_seq, ask_log_id_seq from public, anon, authenticated, service_role;

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
         '_ask_scope', '_ask_contains_pattern', 'ask_jobs', 'ask_payments', '_ask_normalize_name',
         '_ask_name_score', 'ask_find_people', 'ask_rename_chat', 'ask_delete_chat', 'ask_record',
         'ask_purge_old')
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', r.sig);
    if r.proname in ('_ask_scope', '_ask_contains_pattern', 'ask_jobs', 'ask_payments',
                     'ask_find_people', 'ask_rename_chat', 'ask_delete_chat') then
      execute format('grant execute on function %s to authenticated', r.sig);
    elsif r.proname in ('ask_record', 'ask_purge_old') then
      execute format('grant execute on function %s to service_role', r.sig);
    end if;
  end loop;
end;
$$;
