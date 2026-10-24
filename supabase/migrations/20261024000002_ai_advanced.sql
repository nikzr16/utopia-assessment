-- 0009 AI advanced challenges (docs/prd/0009-ai-advanced-prd.md,
-- docs/plan/0009-ai-advanced-plan.md).
-- Builds on 0000-0008; nothing here edits an earlier file.
--
-- Workflow Supervisor
--   order_warnings     warnings on a finished job: fixed rules (amount over
--                      the quote, no photo, returns, reschedules, low rating)
--                      and AI warnings about the written job text. Kept
--                      forever with the order; Managers check each one.
--   supervisor_runs    one row per AI text check (at Job Done, after rework,
--                      or a Manager's Re-check). At Job Done the database
--                      itself asks the ai-assist Edge Function (pg_net, with
--                      a secret from Supabase Vault).
--   Approve (Job Done -> Reviewed) is refused while a warning is open.
-- Document Understanding
--   attachments.is_order_form   the paper order form an Admin read with
--                      "Read from photo", stored at <order>/form/<uuid>.<ext>;
--                      not one of the 6 job files.
-- Operational Insight
--   insight_facts      busy / quiet technicians, review backlog, rising
--                      reschedules, rating drops, from the 0007 kpi_* numbers
--                      (Managers and Admins).
--   insight_wordings   the AI's wording of a set of facts, reused for 7 days.
-- AI log
--   ask_log (0008) also records the supervisor, form and insight AI calls
--   (feature column); the Admin page shows them all.
--
-- src/domain/supervisor.ts and src/domain/insights.ts mirror the limits;
-- tests/db/parity.test.ts keeps both identical.

-- ---------------------------------------------------------------------------
-- AI log: the 0008 Question log records every AI feature.
-- ---------------------------------------------------------------------------
alter table ask_log add column feature text not null default 'ask';
alter table ask_log add constraint ask_log_feature_check
  check (feature in ('ask', 'supervisor', 'form', 'insights'));
alter table ask_log add column order_id uuid references orders (id) on delete set null;
alter table ask_log drop constraint ask_log_outcome_check;
alter table ask_log add constraint ask_log_outcome_check check (outcome in (
  'answered', 'no_data', 'clarify', 'out_of_scope', 'cannot_change', 'refused',
  'not_found', 'ai_unavailable', 'not_set_up', 'timeout', 'error',
  'warnings', 'no_warnings', 'filled', 'unclear', 'worded'));

drop view ask_log_entries;
create view ask_log_entries with (security_invoker = true) as
select l.id, l.created_at, l.staff_id, s.name as staff_name, s.role::text as staff_role,
       b.name as branch_name, s.active as staff_active, l.chat_id, l.question, l.lookups,
       l.row_count, l.outcome, l.duration_ms, l.input_tokens, l.output_tokens,
       l.feature, l.order_id, o.order_no
  from ask_log l
  join staff s on s.id = l.staff_id
  join branches b on b.id = s.branch_id
  left join orders o on o.id = l.order_id;

-- The Edge Function's record of one non-Ask AI call (service_role only).
-- p_summary is a plain line such as "Job check ORDER1042".
create function ai_log_record(
  p_staff_id      uuid,
  p_feature       text,
  p_summary       text,
  p_order_id      uuid,
  p_outcome       text,
  p_duration_ms   integer,
  p_input_tokens  integer,
  p_output_tokens integer
) returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id bigint;
begin
  if p_feature not in ('supervisor', 'form', 'insights') then
    raise exception 'Unknown AI feature %', p_feature;
  end if;
  if not exists (select 1 from staff s where s.id = p_staff_id) then
    raise exception 'No staff member %', p_staff_id;
  end if;
  if p_summary is null or btrim(p_summary) = '' then
    raise exception 'The summary is empty';
  end if;
  insert into ask_log (staff_id, feature, order_id, question, outcome, duration_ms,
                       input_tokens, output_tokens)
  values (p_staff_id, p_feature, p_order_id, left(btrim(p_summary), 300), p_outcome,
          p_duration_ms, p_input_tokens, p_output_tokens)
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Workflow Supervisor: tables
-- ---------------------------------------------------------------------------
create table supervisor_runs (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references orders (id) on delete cascade,
  trigger      text not null check (trigger in ('job_done', 'resubmitted', 'recheck')),
  requested_by uuid references staff (id),
  status       text not null default 'pending'
                 check (status in ('pending', 'running', 'done', 'failed', 'not_set_up')),
  attempts     integer not null default 0,
  error        text,
  created_at   timestamptz not null default now(),
  finished_at  timestamptz
);
create index supervisor_runs_order_idx on supervisor_runs (order_id, created_at desc);
create index supervisor_runs_open_idx on supervisor_runs (created_at) where status in ('pending', 'running');

create table order_warnings (
  id          uuid primary key default gen_random_uuid(),
  -- Display order (the order the rules ran / the AI listed its issues).
  seq         bigint generated always as identity,
  order_id    uuid not null references orders (id) on delete cascade,
  rule        text not null
                check (rule in ('over_quote', 'no_photo', 'many_returns', 'many_reschedules',
                                'low_rating', 'ai_text')),
  source      text not null check (source in ('rule', 'ai')),
  message     text not null check (char_length(message) between 1 and 300),
  facts       jsonb not null default '{}'::jsonb,
  status      text not null default 'open' check (status in ('open', 'checked', 'resolved')),
  opened_at   timestamptz not null default now(),
  checked_by  uuid references staff (id),
  checked_at  timestamptz,
  check_note  text,
  resolved_at timestamptz,
  ai_run_id   uuid references supervisor_runs (id) on delete set null,
  constraint order_warnings_source_rule_check check ((source = 'ai') = (rule = 'ai_text')),
  constraint order_warnings_checked_check check (
    status <> 'checked' or (checked_by is not null and checked_at is not null and check_note is not null)),
  constraint order_warnings_resolved_check check ((status = 'resolved') = (resolved_at is not null))
);
-- One live (open or checked) warning per rule per order.
create unique index order_warnings_live_rule_key on order_warnings (order_id, rule)
  where source = 'rule' and status <> 'resolved';
create index order_warnings_order_idx on order_warnings (order_id, seq);

-- Warnings are history: never deleted while their order exists, and what a
-- warning said never changes (only its status, check and resolution).
create function order_warnings_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from orders o where o.id = old.order_id) then
      raise exception 'Warnings cannot be deleted';
    end if;
    return old;
  end if;
  if new.order_id <> old.order_id or new.rule <> old.rule or new.source <> old.source
     or new.message <> old.message or new.facts <> old.facts
     or new.opened_at <> old.opened_at or old.status = 'resolved' then
    raise exception 'A warning cannot be changed';
  end if;
  return new;
end;
$$;

create trigger order_warnings_guard_trg
  before update or delete on order_warnings
  for each row execute function order_warnings_guard();

-- ---------------------------------------------------------------------------
-- Workflow Supervisor: rules (src/domain/supervisor.ts SUPERVISOR_LIMITS)
-- ---------------------------------------------------------------------------
-- Final amount at least 50% and at least RM 100 above the quote.
create function _supervisor_over_quote(p_quote numeric, p_final numeric) returns boolean
language sql immutable as $$
  select coalesce(p_final >= p_quote * 1.5 and p_final - p_quote >= 100, false);
$$;

create function _supervisor_money(p_amount numeric) returns text
language sql immutable as $$
  select 'RM ' || to_char(p_amount, 'FM999,999,990.00');
$$;

-- Open or resolve one rule's warning. A warning whose numbers change (e.g. a
-- third return) is resolved and a new open one replaces it, so a Manager's
-- note always refers to what they saw.
create function _supervisor_apply(
  p_order_id uuid,
  p_rule     text,
  p_hit      boolean,
  p_message  text,
  p_facts    jsonb
) returns void
language plpgsql as $$
declare
  v_row order_warnings;
begin
  select * into v_row from order_warnings
   where order_id = p_order_id and rule = p_rule and source = 'rule' and status <> 'resolved'
   for update;
  if not coalesce(p_hit, false) then
    if found then
      update order_warnings set status = 'resolved', resolved_at = now() where id = v_row.id;
    end if;
    return;
  end if;
  if found then
    if v_row.facts = p_facts then
      return;
    end if;
    update order_warnings set status = 'resolved', resolved_at = now() where id = v_row.id;
  end if;
  insert into order_warnings (order_id, rule, source, message, facts)
  values (p_order_id, p_rule, 'rule', p_message, p_facts);
end;
$$;

-- Run every rule for an order that is Job Done, Reviewed or Closed. Earlier
-- statuses keep their warnings as they are (a job back in rework is checked
-- again when it is resubmitted).
create function _supervisor_rules(p_order_id uuid) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_order   orders;
  v_extra   numeric := 0;
  v_final   numeric;
  v_photos  integer;
  v_returns integer;
  v_moves   integer;
  v_rating  smallint;
  v_working boolean;
  v_rated   boolean := false;
begin
  select * into v_order from orders where id = p_order_id;
  if not found or v_order.status not in ('job_done', 'reviewed', 'closed') then
    return;
  end if;

  select coalesce(c.extra_charges, 0) into v_extra from order_completions c where c.order_id = p_order_id;
  v_extra := coalesce(v_extra, 0);
  v_final := v_order.quoted_price + v_extra;

  select count(*) into v_photos
    from attachments a
   where a.order_id = p_order_id and a.payment_id is null and not a.is_order_form and a.kind = 'photo';
  select count(*) into v_returns
    from audit_log a where a.order_id = p_order_id and a.action = 'returned_for_rework';
  select count(*) into v_moves from order_reschedules r where r.order_id = p_order_id;
  select f.rating, f.working_well, true into v_rating, v_working, v_rated
    from customer_feedback f
    join customer_messages m on m.id = f.message_id
   where f.order_id = p_order_id
   order by m.created_at desc, m.id desc
   limit 1;
  v_rated := coalesce(v_rated, false);

  perform _supervisor_apply(p_order_id, 'over_quote',
    _supervisor_over_quote(v_order.quoted_price, v_final),
    case when v_order.quoted_price > 0 then
      format('Final amount %s is %s%% above the quoted %s.', _supervisor_money(v_final),
        round((v_final - v_order.quoted_price) / v_order.quoted_price * 100), _supervisor_money(v_order.quoted_price))
    else
      format('Final amount %s with a quoted price of RM 0.00.', _supervisor_money(v_final))
    end,
    jsonb_build_object('quoted', v_order.quoted_price, 'final', v_final));

  perform _supervisor_apply(p_order_id, 'no_photo', v_photos = 0,
    'Job Done but no photos uploaded.', '{}'::jsonb);

  perform _supervisor_apply(p_order_id, 'many_returns', v_returns >= 2,
    format('Returned for rework %s times.', v_returns),
    jsonb_build_object('returns', v_returns));

  perform _supervisor_apply(p_order_id, 'many_reschedules', v_moves >= 3,
    format('Rescheduled or postponed %s times.', v_moves),
    jsonb_build_object('reschedules', v_moves));

  perform _supervisor_apply(p_order_id, 'low_rating',
    v_rated and _is_low_feedback(v_rating, v_working),
    case when v_rated and not v_working then
      format('Customer said the aircond is not working (rated %s %s).', v_rating,
        case when v_rating = 1 then 'star' else 'stars' end)
    else
      format('Customer rated %s %s.', v_rating, case when v_rating = 1 then 'star' else 'stars' end)
    end,
    jsonb_build_object('rating', v_rating, 'working_well', v_working));
end;
$$;

-- ---------------------------------------------------------------------------
-- Workflow Supervisor: starting the AI text check
-- ---------------------------------------------------------------------------
-- The ai-assist function's address (set by the hosted SQL update; none here,
-- so nothing is called until it is set).
insert into app_settings (key, value) values ('ai_assist_url', '') on conflict (key) do nothing;

-- Ask the ai-assist Edge Function to run a check (pg_net, fire and forget).
-- Needs the pg_net extension, app_settings.ai_assist_url and the Vault secret
-- `ai_trigger_secret`; without them the run stays pending and the order page
-- offers Re-check. Never fails the caller (Job Done must not depend on it).
create function _supervisor_post(p_run_id uuid) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_url    text;
  v_secret text;
begin
  update supervisor_runs set attempts = attempts + 1 where id = p_run_id;
  if to_regnamespace('net') is null then
    return;
  end if;
  select nullif(btrim(value), '') into v_url from app_settings where key = 'ai_assist_url';
  if v_url is null then
    return;
  end if;
  begin
    if to_regclass('vault.decrypted_secrets') is not null then
      execute 'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1'
        into v_secret using 'ai_trigger_secret';
    end if;
    if v_secret is null or btrim(v_secret) = '' then
      return;
    end if;
    execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 30000)'
      using v_url,
            jsonb_build_object('action', 'supervisor_check', 'run_id', p_run_id),
            jsonb_build_object('Content-Type', 'application/json', 'x-ai-trigger', v_secret);
  exception when others then
    raise warning 'Could not start the AI check %: %', p_run_id, sqlerrm;
  end;
end;
$$;

create function _supervisor_start_run(p_order_id uuid, p_trigger text, p_requested_by uuid)
returns supervisor_runs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run supervisor_runs;
begin
  insert into supervisor_runs (order_id, trigger, requested_by)
  values (p_order_id, p_trigger, p_requested_by)
  returning * into v_run;
  return v_run;
end;
$$;

-- Job Done (first time or after rework): run the rules and start the AI check.
create function orders_supervisor_job_done() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run supervisor_runs;
begin
  perform _supervisor_rules(new.id);
  v_run := _supervisor_start_run(new.id,
    case when exists (select 1 from supervisor_runs r where r.order_id = new.id and r.trigger <> 'recheck')
         then 'resubmitted' else 'job_done' end,
    null);
  perform _supervisor_post(v_run.id);
  return null;
end;
$$;

create trigger orders_supervisor_job_done_trg
  after update of status on orders
  for each row
  when (new.status = 'job_done' and old.status is distinct from 'job_done')
  execute function orders_supervisor_job_done();

-- A rating or a reschedule after Job Done updates the rule warnings.
create function supervisor_rules_on_event() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform _supervisor_rules(new.order_id);
  return null;
end;
$$;

create trigger customer_feedback_supervisor_trg
  after insert on customer_feedback
  for each row execute function supervisor_rules_on_event();

create trigger order_reschedules_supervisor_trg
  after insert on order_reschedules
  for each row execute function supervisor_rules_on_event();

-- Approve only once every warning is checked (PRD Q8). An AI check that did
-- not run does not block (PRD Q18); returning for rework is never blocked.
create function orders_open_warnings_guard() returns trigger
language plpgsql as $$
declare
  v_open integer;
begin
  if old.status = 'job_done' and new.status = 'reviewed' then
    select count(*) into v_open from order_warnings w where w.order_id = new.id and w.status = 'open';
    if v_open > 0 then
      raise exception 'Check every warning before approving (% open)', v_open;
    end if;
  end if;
  return new;
end;
$$;

create trigger orders_open_warnings_guard_trg
  before update of status on orders
  for each row execute function orders_open_warnings_guard();

-- Runs left pending (no pg_net, a lost request) are posted again, twice at
-- most; then, like runs stuck while running, they are marked failed so the
-- order page offers Re-check. Every 5 minutes (pg_cron).
create function supervisor_retry_pending() returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
begin
  update supervisor_runs
     set status = 'failed', error = 'The AI check stopped before it finished', finished_at = now()
   where status = 'running' and created_at < now() - interval '5 minutes';
  for r in
    select id, attempts from supervisor_runs
     where status = 'pending' and created_at < now() - interval '2 minutes'
     order by created_at
     for update skip locked
  loop
    if r.attempts >= 2 then
      update supervisor_runs
         set status = 'failed', error = 'The AI check did not start', finished_at = now()
       where id = r.id;
    else
      perform _supervisor_post(r.id);
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Workflow Supervisor: the Edge Function's side (service_role only)
-- ---------------------------------------------------------------------------
-- What the AI may read for one run, and the run marked running. Only the
-- written job text and its money: no customer name, phone, address, notes or
-- feedback. The AI warnings a Manager already checked go along with their
-- notes so they are not raised again (plan P4). p_requested_by: a Manager's
-- Re-check may only run the check they asked for.
create function supervisor_ai_input(p_run_id uuid, p_requested_by uuid default null) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run   supervisor_runs;
  v_order orders;
  v_done  order_completions;
  v_type  text;
begin
  select * into v_run from supervisor_runs where id = p_run_id for update;
  if not found or (p_requested_by is not null and v_run.requested_by is distinct from p_requested_by) then
    raise exception 'Check not found';
  end if;
  if v_run.status not in ('pending', 'running') then
    raise exception 'This check already finished';
  end if;
  select * into v_order from orders where id = v_run.order_id;
  select * into v_done from order_completions where order_id = v_run.order_id;
  select name into v_type from service_types where id = v_order.service_type_id;
  update supervisor_runs set status = 'running' where id = p_run_id;

  return jsonb_build_object(
    'run_id', v_run.id,
    'order_id', v_order.id,
    'order_no', v_order.order_no,
    'status', v_order.status,
    'trigger', v_run.trigger,
    'requested_by', v_run.requested_by,
    'log_staff_id', coalesce(v_run.requested_by, v_done.technician_id, v_order.assigned_technician_id),
    'job', jsonb_build_object(
      'service_type', v_type,
      'quoted_price', v_order.quoted_price,
      'extra_charges', coalesce(v_done.extra_charges, 0),
      'final_amount', v_order.quoted_price + coalesce(v_done.extra_charges, 0),
      'problem_description', v_order.problem_description,
      'work_done', v_done.work_done,
      'remarks', v_done.remarks),
    'already_checked', coalesce((
      select jsonb_agg(jsonb_build_object('warning', w.message, 'manager_note', w.check_note)
                       order by w.checked_at)
        from order_warnings w
       where w.order_id = v_order.id and w.source = 'ai' and w.status = 'checked'), '[]'::jsonb));
end;
$$;

-- Save a run's result. 'done': this order's open AI warnings are replaced by
-- p_issues (at most 3); checked ones are never touched. Other statuses only
-- close the run.
create function supervisor_save_ai(
  p_run_id uuid,
  p_status text,
  p_issues text[],
  p_error  text
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run   supervisor_runs;
  v_issue text;
  v_count integer := 0;
begin
  if p_status not in ('done', 'failed', 'not_set_up') then
    raise exception 'Unknown check status %', p_status;
  end if;
  select * into v_run from supervisor_runs where id = p_run_id for update;
  if not found then
    raise exception 'Check not found';
  end if;
  if v_run.status not in ('pending', 'running') then
    raise exception 'This check already finished';
  end if;

  if p_status = 'done' then
    perform 1 from orders where id = v_run.order_id for update;
    update order_warnings set status = 'resolved', resolved_at = now()
     where order_id = v_run.order_id and source = 'ai' and status = 'open';
    foreach v_issue in array coalesce(p_issues, '{}'::text[]) loop
      v_issue := btrim(regexp_replace(coalesce(v_issue, ''), '\s+', ' ', 'g'));
      continue when v_issue = '';
      v_count := v_count + 1;
      exit when v_count > 3;
      insert into order_warnings (order_id, rule, source, message, ai_run_id)
      values (v_run.order_id, 'ai_text', 'ai', left(v_issue, 300), v_run.id);
    end loop;
  end if;

  update supervisor_runs
     set status = p_status, error = left(p_error, 300), finished_at = now()
   where id = p_run_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Workflow Supervisor: what Managers do
-- ---------------------------------------------------------------------------
-- Check one open warning with a short note (a covering Manager, job waiting
-- for review).
create function check_order_warning(p_warning_id uuid, p_note text) returns order_warnings
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor   staff := _require_actor();
  v_warning order_warnings;
  v_order   orders;
  v_note    text := btrim(regexp_replace(coalesce(p_note, ''), '\s+', ' ', 'g'));
begin
  select * into v_warning from order_warnings where id = p_warning_id;
  if not found then
    raise exception 'Warning not found';
  end if;
  v_order := _lock_order(v_warning.order_id);
  if v_actor.role <> 'manager' or not _covers_branch(v_actor, v_order.branch_id) then
    raise exception 'Only a Manager of % can check warnings',
      (select name from branches where id = v_order.branch_id);
  end if;
  if v_order.status <> 'job_done' then
    raise exception 'Warnings can only be checked while the job is waiting for review';
  end if;
  select * into v_warning from order_warnings where id = p_warning_id for update;
  if v_warning.status <> 'open' then
    raise exception 'This warning is no longer open';
  end if;
  if char_length(v_note) < 3 then
    raise exception 'Write a short note (at least 3 characters)';
  end if;
  if char_length(v_note) > 300 then
    raise exception 'Keep the note to 300 characters';
  end if;
  update order_warnings
     set status = 'checked', checked_by = v_actor.id, checked_at = now(), check_note = v_note
   where id = p_warning_id
  returning * into v_warning;
  return v_warning;
end;
$$;

-- Ask for a fresh AI check (a covering Manager, job waiting for review). A
-- check already waiting from the last 2 minutes is returned instead of a new
-- one. The browser then asks ai-assist to run it with the Manager's token.
create function request_supervisor_recheck(p_order_id uuid) returns supervisor_runs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor staff := _require_actor();
  v_order orders := _lock_order(p_order_id);
  v_run   supervisor_runs;
begin
  if v_actor.role <> 'manager' or not _covers_branch(v_actor, v_order.branch_id) then
    raise exception 'Only a Manager of % can re-check a job',
      (select name from branches where id = v_order.branch_id);
  end if;
  if v_order.status <> 'job_done' then
    raise exception 'Only a job waiting for review can be re-checked';
  end if;
  select * into v_run from supervisor_runs r
   where r.order_id = p_order_id and r.status in ('pending', 'running')
     and r.created_at > now() - interval '2 minutes'
   order by r.created_at desc
   limit 1;
  if found then
    return v_run;
  end if;
  return _supervisor_start_run(p_order_id, 'recheck', v_actor.id);
end;
$$;

alter table order_warnings  enable row level security;
alter table supervisor_runs enable row level security;

-- Admins, Finance and covering Managers (whoever reads the order, except
-- technicians: they never see warnings).
create policy order_warnings_read on order_warnings
  for select to authenticated
  using (_current_staff_role() in ('admin', 'finance', 'manager')
         and exists (select 1 from orders o where o.id = order_warnings.order_id));

create policy supervisor_runs_read on supervisor_runs
  for select to authenticated
  using (_current_staff_role() in ('admin', 'finance', 'manager')
         and exists (select 1 from orders o where o.id = supervisor_runs.order_id));

-- ---------------------------------------------------------------------------
-- Document Understanding: the order form file
-- ---------------------------------------------------------------------------
alter table attachments add column is_order_form boolean not null default false;
alter table attachments add constraint attachments_order_form_check
  check (not is_order_form or (payment_id is null and kind in ('photo', 'pdf')));
create unique index attachments_one_order_form_key on attachments (order_id) where is_order_form;

-- At most 6 job files per order (same as 0000); receipts and the order form
-- do not count.
create or replace function attachments_limit() returns trigger
language plpgsql as $$
declare
  v_count integer;
begin
  if new.payment_id is null and not new.is_order_form then
    -- Serialise concurrent inserts for the same order.
    perform 1 from orders where id = new.order_id for update;
    select count(*) into v_count
      from attachments
     where order_id = new.order_id
       and payment_id is null
       and not is_order_form
       and id <> new.id;
    if v_count >= 6 then
      raise exception 'An order can have at most 6 completion attachments';
    end if;
  end if;
  return new;
end;
$$;

-- The order an order-form path belongs to (<order>/form/<uuid>.<ext>), or null.
create function _order_form_order(p_name text) returns uuid
language sql immutable as $$
  select case
    when p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/form/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,5}$'
    then split_part(p_name, '/', 1)::uuid
  end;
$$;

-- Who may change the order form, and when (plan P8). Null = allowed.
create function _order_form_write_error(p_actor staff, p_order orders) returns text
language plpgsql stable as $$
begin
  if p_actor.role <> 'admin' then
    return 'Only an Admin can change the order form';
  end if;
  if p_order.status not in ('new', 'assigned', 'acknowledged') then
    return format('The order form can only be changed while the order is New, Assigned or Acknowledged (it is currently %s)',
      _status_label(p_order.status));
  end if;
  return null;
end;
$$;

-- Storage: job files as in 0004, plus the order form (read like job files;
-- written by Admins before work starts).
create or replace function _can_access_job_file(p_name text, p_action text) returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_form     boolean := _order_form_order(p_name) is not null;
  v_order_id uuid := coalesce(_job_file_order(p_name), _order_form_order(p_name));
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
  if v_form then
    if _order_form_write_error(v_actor, v_order) is not null then
      return false;
    end if;
  elsif _job_file_write_error(v_actor, v_order, _job_file_is_receipt(p_name)) is not null then
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

-- Register the uploaded order form (a photo or a PDF), replacing the one
-- before. Calling it again for the same file returns it (safe to retry). The
-- browser deletes the replaced file from Storage afterwards.
create function set_order_form(
  p_order_id     uuid,
  p_storage_path text,
  p_file_name    text default null
) returns attachments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor    staff := _require_actor();
  v_order    orders := _lock_order(p_order_id);
  v_error    text := _order_form_write_error(v_actor, v_order);
  v_object   record;
  v_kind     attachment_kind;
  v_row      attachments;
  v_replaced boolean;
begin
  if v_error is not null then
    raise exception '%', v_error;
  end if;
  if _order_form_order(p_storage_path) is distinct from v_order.id then
    raise exception 'This file does not belong to %', v_order.order_no;
  end if;
  select * into v_row from attachments where storage_path = p_storage_path;
  if found then
    if v_row.order_id = v_order.id and v_row.is_order_form then
      return v_row;
    end if;
    raise exception 'This file is already attached';
  end if;

  v_object := _job_file_object(p_storage_path, v_actor);
  v_kind := _job_file_kind(v_object.mime, v_object.size, false);
  if v_kind not in ('photo', 'pdf') then
    raise exception 'The order form must be a photo or a PDF';
  end if;

  delete from attachments where order_id = v_order.id and is_order_form;
  v_replaced := found;
  insert into attachments (order_id, kind, storage_path, mime_type, file_name, size_bytes,
                           uploaded_by, is_order_form)
  values (v_order.id, v_kind, p_storage_path, lower(split_part(v_object.mime, ';', 1)),
          left(nullif(btrim(coalesce(p_file_name, '')), ''), 200), v_object.size, v_actor.id, true)
  returning * into v_row;

  perform _audit(v_order.id, v_actor, 'order_form_added', null, null, null,
    jsonb_build_object('attachment_id', v_row.id, 'kind', v_row.kind,
                       'file_name', v_row.file_name, 'replaced', v_replaced));
  return v_row;
end;
$$;

-- Unregister the order form; returns the removed row so the browser can
-- delete the stored file.
create function remove_order_form(p_order_id uuid) returns attachments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor staff := _require_actor();
  v_order orders := _lock_order(p_order_id);
  v_error text := _order_form_write_error(v_actor, v_order);
  v_row   attachments;
begin
  if v_error is not null then
    raise exception '%', v_error;
  end if;
  delete from attachments where order_id = v_order.id and is_order_form returning * into v_row;
  if not found then
    raise exception 'This order has no order form';
  end if;
  perform _audit(v_order.id, v_actor, 'order_form_removed', null, null, null,
    jsonb_build_object('attachment_id', v_row.id, 'kind', v_row.kind, 'file_name', v_row.file_name));
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- Operational Insight (src/domain/insights.ts INSIGHT_LIMITS)
-- ---------------------------------------------------------------------------
-- Busy: at least 1.5x the team average and at least 3 more.
create function _insight_busy(p_jobs numeric, p_average numeric) returns boolean
language sql immutable as $$
  select coalesce(p_jobs >= p_average * 1.5 and p_jobs >= p_average + 3, false);
$$;

-- Quiet: at most half the team average and at least 3 fewer.
create function _insight_quiet(p_jobs numeric, p_average numeric) returns boolean
language sql immutable as $$
  select coalesce(p_jobs <= p_average * 0.5 and p_jobs <= p_average - 3, false);
$$;

-- Rising reschedules: at least double the previous period and at least 3 more.
create function _insight_reschedules_up(p_now integer, p_before integer) returns boolean
language sql immutable as $$
  select coalesce(p_now >= p_before * 2 and p_now >= p_before + 3, false);
$$;

-- Rating drop: the average fell by 1.0 or more, with 3 or more ratings in
-- each period.
create function _insight_rating_drop(p_now numeric, p_now_rated integer, p_before numeric, p_before_rated integer)
returns boolean
language sql immutable as $$
  select coalesce(p_now_rated >= 3 and p_before_rated >= 3 and p_before - p_now >= 1.0, false);
$$;

-- The insights of a period [p_start, p_end) for the branches the caller sees
-- (Admins all, Managers those they cover; others refused). Numbers come from
-- kpi_technicians / kpi_branches, so they equal the dashboard. The previous
-- period is the one of the same length just before. Review backlog is now:
-- jobs waiting for review for more than 2 days.
create function insight_facts(p_start date, p_end date, p_branch_id uuid default null)
returns table (
  kind              text,
  technician_id     uuid,
  technician_name   text,
  technician_active boolean,
  branch_id         uuid,
  branch_name       text,
  value             numeric,
  previous          numeric,
  team_average      numeric,
  days              integer
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
  v_before   date;
  v_average  numeric;
begin
  if v_actor.role not in ('admin', 'manager') then
    raise exception 'Insights are for Managers and Admins';
  end if;
  perform _kpi_period(p_start, p_end);
  v_branches := _kpi_visible_branches(v_actor, p_branch_id);
  v_before := p_start - (p_end - p_start);

  return query
    with now_t as (
      select * from kpi_technicians(p_start, p_end, p_branch_id)
    ),
    avg_t as (
      select round(avg(t.jobs_completed), 1) as a, count(*) as n from now_t t
    ),
    before_t as (
      select * from kpi_technicians(v_before, p_start, p_branch_id)
    ),
    now_b as (
      select * from kpi_branches(p_start, p_end) b where b.branch_id = any (v_branches)
    ),
    before_b as (
      select * from kpi_branches(v_before, p_start) b where b.branch_id = any (v_branches)
    ),
    backlog as (
      select o.branch_id as bid, count(*)::numeric as n,
             max(floor(extract(epoch from now() - c.completed_at) / 86400))::integer as oldest
        from orders o
        join order_completions c on c.order_id = o.id
       where o.status = 'job_done'
         and o.branch_id = any (v_branches)
         and c.completed_at <= now() - interval '2 days'
       group by o.branch_id
    ),
    facts as (
      select 1 as ord, 'busy'::text as k, t.id as tid, t.name as tname, t.active as tactive,
             t.branch_id as bid, t.branch_name as bname, t.jobs_completed::numeric as v,
             null::numeric as p, a.a as avg_jobs, null::integer as d
        from now_t t, avg_t a
       where a.n >= 2 and _insight_busy(t.jobs_completed, a.a)
      union all
      select 2, 'quiet', t.id, t.name, t.active, t.branch_id, t.branch_name, t.jobs_completed::numeric,
             null, a.a, null
        from now_t t, avg_t a
       where a.n >= 2 and t.active and _insight_quiet(t.jobs_completed, a.a)
      union all
      select 3, 'review_backlog', null, null, null, bl.bid, b.name, bl.n, null, null, bl.oldest
        from backlog bl join branches b on b.id = bl.bid
      union all
      select 4, 'reschedules_up', null, null, null, n.branch_id, n.branch_name, n.reschedules::numeric,
             coalesce(p.reschedules, 0)::numeric, null, null
        from now_b n left join before_b p on p.branch_id = n.branch_id
       where _insight_reschedules_up(n.reschedules, coalesce(p.reschedules, 0))
      union all
      select 5, 'rating_drop', n.id, n.name, n.active, n.branch_id, n.branch_name, n.average_rating,
             p.average_rating, null, null
        from now_t n join before_t p on p.id = n.id
       where _insight_rating_drop(n.average_rating, n.rated, p.average_rating, p.rated)
    )
    select f.k, f.tid, f.tname, f.tactive, f.bid, f.bname, f.v, f.p, f.avg_jobs, f.d
      from facts f
     order by f.ord, f.v desc, lower(coalesce(f.tname, f.bname));
end;
$$;

-- The AI's wording of a set of facts (keyed by a hash of the facts and the
-- period label), reused until the facts change; removed after 7 days.
create table insight_wordings (
  hash       text primary key check (char_length(hash) between 16 and 128),
  sentences  jsonb not null,
  tip        text,
  created_at timestamptz not null default now()
);
alter table insight_wordings enable row level security;

create function insight_wording_get(p_hash text) returns insight_wordings
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select * from insight_wordings
   where hash = p_hash and created_at > now() - interval '7 days';
$$;

create function insight_wording_put(p_hash text, p_sentences jsonb, p_tip text) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if jsonb_typeof(p_sentences) is distinct from 'array' then
    raise exception 'The sentences must be a list';
  end if;
  insert into insight_wordings (hash, sentences, tip)
  values (p_hash, p_sentences, left(nullif(btrim(coalesce(p_tip, '')), ''), 200))
  on conflict (hash) do update
    set sentences = excluded.sentences, tip = excluded.tip, created_at = now();
end;
$$;

-- 0008's nightly purge also removes old insight wordings.
create or replace function ask_purge_old() returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from ask_log where created_at <= now() - interval '7 days';
  delete from ask_messages where created_at <= now() - interval '7 days';
  delete from ask_chats where updated_at <= now() - interval '7 days';
  delete from insight_wordings where created_at <= now() - interval '7 days';
end;
$$;

-- ---------------------------------------------------------------------------
-- Extensions and schedules (Supabase; skipped in PGlite)
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
  end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('supervisor-retry', '*/5 * * * *', 'select public.supervisor_retry_pending()');
  end if;
end;
$$;

-- Live updates on the order page (Warnings box).
do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['order_warnings', 'supervisor_runs'] loop
      if not exists (
           select 1 from pg_publication_tables
            where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end;
$$;

comment on function insight_facts(date, date, uuid) is
  'AI lookup workload_insights. Managers (covered branches) and Admins. Kinds: busy / quiet (completed jobs vs team_average), review_backlog (value = jobs waiting more than 2 days, days = oldest), reschedules_up (value now, previous = the period before), rating_drop (average rating now and before).';

-- ---------------------------------------------------------------------------
-- Privileges
-- * authenticated: read warnings / runs (RLS), check a warning, ask for a
--   re-check, set / remove the order form, insight_facts.
-- * service_role (the ai-assist Edge Function): the run input and result,
--   the AI log, the insight wordings, the retry sweep.
-- ---------------------------------------------------------------------------
revoke all on order_warnings, supervisor_runs, insight_wordings, ask_log_entries
  from public, anon, authenticated, service_role;
grant select on order_warnings, supervisor_runs, ask_log_entries to authenticated;
revoke all on sequence order_warnings_seq_seq from public, anon, authenticated, service_role;

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
         'ai_log_record', 'order_warnings_guard', '_supervisor_over_quote', '_supervisor_money',
         '_supervisor_apply', '_supervisor_rules', '_supervisor_post', '_supervisor_start_run',
         'orders_supervisor_job_done', 'supervisor_rules_on_event', 'orders_open_warnings_guard',
         'supervisor_retry_pending', 'supervisor_ai_input', 'supervisor_save_ai',
         'check_order_warning', 'request_supervisor_recheck', '_order_form_order',
         '_order_form_write_error', 'set_order_form', 'remove_order_form', '_insight_busy',
         '_insight_quiet', '_insight_reschedules_up', '_insight_rating_drop', 'insight_facts',
         'insight_wording_get', 'insight_wording_put')
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', r.sig);
    if r.proname in ('check_order_warning', 'request_supervisor_recheck', 'set_order_form',
                     'remove_order_form', 'insight_facts') then
      execute format('grant execute on function %s to authenticated', r.sig);
    elsif r.proname in ('ai_log_record', 'supervisor_ai_input', 'supervisor_save_ai',
                        'insight_wording_get', 'insight_wording_put', 'supervisor_retry_pending') then
      execute format('grant execute on function %s to service_role', r.sig);
    end if;
  end loop;
end;
$$;
