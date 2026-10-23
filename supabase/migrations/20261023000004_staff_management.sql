-- 0006 Staff management (docs/prd/0006-staff-management-prd.md,
-- docs/plan/0006-staff-management-plan.md).
--
-- * staff.joined_at (the day the profile was added; earlier staff: the day the
--   foundation seed was applied) and staff.left_at (set while inactive).
-- * staff_history: an append-only record of every staff change (who, when,
--   what changed from -> to) plus the person's role, home branch and active
--   state after it, so the KPI dashboard (0007) can count active technicians
--   per branch on any past date. Written by a trigger for every insert and
--   update (SQL changes included) and by staff_access_event for invites and
--   password resets. Never a password.
-- * Staff rules (triggers, so SQL changes obey them too): phone stored as
--   digits with the country code; a technician needs a Malaysian mobile
--   (WhatsApp); a phone is used by one active staff member only; a technician
--   with open jobs (Assigned / Acknowledged / In Progress) cannot be
--   deactivated or change role; the last active Admin and the last active
--   Finance user cannot be deactivated or change role (checked at commit).
-- * Who may change whom (RPCs): Admins manage everyone and branch cover; a
--   Manager manages technicians whose home branch they cover, only within
--   their covered branches, and never roles, cover or emails (an email
--   change moves the sign-in). Nobody deactivates themselves or changes
--   their own role.
-- * The RPCs check the 0004 "Manager first" / last-Manager rules before
--   saving, with a message naming the branch and the fix; the 0004 commit
--   check stays the final word.
-- * Sign-ins are created and changed by the staff-access server function
--   (supabase/functions/staff-access), the only holder of the secret key. It
--   calls these RPCs as the signed-in person first; link_invited_staff is for
--   the secret key only.
-- * A signed-in person may read their own staff row even when inactive, and
--   staff joins the Realtime publication, so an open app signs out the moment
--   its person is deactivated.
-- * order_review_summary gains the ids behind its staff names, so screens can
--   tag inactive staff.
--
-- src/domain/staff.ts mirrors the pure rules; tests/db/parity.test.ts keeps
-- both identical.

-- ---------------------------------------------------------------------------
-- Joined / left dates
-- ---------------------------------------------------------------------------
alter table staff add column joined_at timestamptz not null default now();
alter table staff add column left_at timestamptz;

-- Staff from before 0006 joined when the foundation seed was applied.
update staff set joined_at = timestamptz '2026-10-22 00:00:00+08';
update staff set left_at = now() where not active;
-- Run the 0004 commit-time staff check for these updates now: a table with
-- pending trigger events cannot be altered later in this migration.
set constraints all immediate;

alter table staff add constraint staff_left_check check ((left_at is null) = active);

-- ---------------------------------------------------------------------------
-- Staff history
-- ---------------------------------------------------------------------------
create table staff_history (
  id         bigint generated always as identity primary key,
  staff_id   uuid not null references staff (id) on delete cascade, -- test cleanup only: staff are never deleted
  actor_id   uuid references staff (id) on delete set null, -- null: a set-up script or plain SQL
  action     text not null,
  changes    jsonb not null default '{}'::jsonb,
  -- The person's state after this change (for 0007).
  role       staff_role not null,
  branch_id  uuid not null references branches (id),
  active     boolean not null,
  created_at timestamptz not null default now(),
  constraint staff_history_action_check check (action in (
    'created', 'updated', 'cover_changed', 'deactivated', 'reactivated',
    'invite_sent', 'password_reset'))
);

create index staff_history_staff_idx on staff_history (staff_id, id);
create index staff_history_created_idx on staff_history (created_at);

-- Rows change only along with a deleted staff row (test cleanup; staff are
-- never deleted in the app): the row goes with its person, and an actor who is
-- deleted becomes null.
create function staff_history_append_only() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from staff where id = old.staff_id) then
    return old;
  end if;
  if tg_op = 'UPDATE' and old.actor_id is not null and new.actor_id is null
     and not exists (select 1 from staff where id = old.actor_id)
     and (new.id, new.staff_id, new.action, new.changes, new.role, new.branch_id, new.active, new.created_at)
         is not distinct from
         (old.id, old.staff_id, old.action, old.changes, old.role, old.branch_id, old.active, old.created_at) then
    return new;
  end if;
  raise exception 'Staff history cannot be changed';
end;
$$;

create trigger staff_history_no_update_trg
  before update or delete on staff_history
  for each row execute function staff_history_append_only();

-- Branch names for a list of branch ids, sorted.
create function _branch_names(p_ids uuid[]) returns text[]
language sql stable as $$
  select coalesce(array_agg(b.name order by b.name), '{}')
    from branches b
   where b.id = any (coalesce(p_ids, '{}'));
$$;

-- Staff from before 0006: one "created" entry each (and "deactivated" for
-- anyone already inactive).
insert into staff_history (staff_id, actor_id, action, changes, role, branch_id, active, created_at)
select s.id, null, 'created',
       jsonb_strip_nulls(jsonb_build_object(
         'name',   jsonb_build_object('to', s.name),
         'email',  jsonb_build_object('to', s.email),
         'phone',  jsonb_build_object('to', s.phone),
         'role',   jsonb_build_object('to', s.role),
         'branch', jsonb_build_object('to', (select name from branches where id = s.branch_id)),
         'cover',  case when cardinality(s.additional_branch_ids) > 0
                        then jsonb_build_object('to', to_jsonb(_branch_names(s.additional_branch_ids))) end)),
       s.role, s.branch_id, true, s.joined_at
  from staff s
 order by s.joined_at, s.name;

insert into staff_history (staff_id, actor_id, action, changes, role, branch_id, active, created_at)
select s.id, null, 'deactivated', '{}'::jsonb, s.role, s.branch_id, false, s.left_at
  from staff s
 where not s.active;

-- Every insert and update of a staff row (except linking a sign-in) adds a
-- history entry. The actor is the signed-in staff member, or null for SQL.
create function staff_history_record() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_changes jsonb := '{}'::jsonb;
  v_action  text;
begin
  if tg_op = 'INSERT' then
    v_action := 'created';
    v_changes := jsonb_strip_nulls(jsonb_build_object(
      'name',   jsonb_build_object('to', new.name),
      'email',  jsonb_build_object('to', new.email),
      'phone',  jsonb_build_object('to', new.phone),
      'role',   jsonb_build_object('to', new.role),
      'branch', jsonb_build_object('to', (select name from branches where id = new.branch_id)),
      'cover',  case when cardinality(new.additional_branch_ids) > 0
                     then jsonb_build_object('to', to_jsonb(_branch_names(new.additional_branch_ids))) end));
  else
    if new.name is distinct from old.name then
      v_changes := v_changes || jsonb_build_object('name', jsonb_build_object('from', old.name, 'to', new.name));
    end if;
    if new.email is distinct from old.email then
      v_changes := v_changes || jsonb_build_object('email', jsonb_build_object('from', old.email, 'to', new.email));
    end if;
    if new.phone is distinct from old.phone then
      v_changes := v_changes || jsonb_build_object('phone', jsonb_build_object('from', old.phone, 'to', new.phone));
    end if;
    if new.role is distinct from old.role then
      v_changes := v_changes || jsonb_build_object('role', jsonb_build_object('from', old.role, 'to', new.role));
    end if;
    if new.branch_id is distinct from old.branch_id then
      v_changes := v_changes || jsonb_build_object('branch', jsonb_build_object(
        'from', (select name from branches where id = old.branch_id),
        'to',   (select name from branches where id = new.branch_id)));
    end if;
    if _branch_names(new.additional_branch_ids) is distinct from _branch_names(old.additional_branch_ids) then
      v_changes := v_changes || jsonb_build_object('cover', jsonb_build_object(
        'from', to_jsonb(_branch_names(old.additional_branch_ids)),
        'to',   to_jsonb(_branch_names(new.additional_branch_ids))));
    end if;

    if new.active is distinct from old.active then
      v_action := case when new.active then 'reactivated' else 'deactivated' end;
    elsif v_changes = '{}'::jsonb then
      return null; -- only a sign-in link or the joined / left dates changed
    elsif (select array_agg(k) from jsonb_object_keys(v_changes) as k) = array['cover'] then
      v_action := 'cover_changed';
    else
      v_action := 'updated';
    end if;
  end if;

  insert into staff_history (staff_id, actor_id, action, changes, role, branch_id, active)
  values (new.id, _current_staff_id(), v_action, v_changes, new.role, new.branch_id, new.active);
  return null;
end;
$$;

create trigger staff_history_trg
  after insert or update on staff
  for each row execute function staff_history_record();

-- ---------------------------------------------------------------------------
-- Rules
-- ---------------------------------------------------------------------------
create function _role_label(p_role staff_role) returns text
language sql immutable as $$
  select case p_role
    when 'admin'      then 'Admin'
    when 'technician' then 'Technician'
    when 'manager'    then 'Manager'
    when 'finance'    then 'Finance'
  end;
$$;

-- A name: trimmed, 1-100 characters. Returns the name to store.
create function _check_staff_name(p_name text) returns text
language plpgsql immutable as $$
declare
  v_name text := btrim(coalesce(p_name, ''), E' \t\r\n\f\v');
begin
  if v_name = '' then
    raise exception 'Name is required';
  end if;
  if char_length(v_name) > 100 then
    raise exception 'The name can be at most 100 characters';
  end if;
  return v_name;
end;
$$;

-- An email: trimmed, lower case, one @ and a dot in the domain, at most 254
-- characters. Returns the email to store.
create function _check_staff_email(p_email text) returns text
language plpgsql immutable as $$
declare
  v_email text := lower(btrim(coalesce(p_email, ''), E' \t\r\n\f\v'));
begin
  if v_email = '' then
    raise exception 'Email is required';
  end if;
  if char_length(v_email) > 254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Enter a valid email address, for example ravi@example.com';
  end if;
  return v_email;
end;
$$;

-- The phone rule by role: a technician gets the assignment WhatsApp, so needs
-- a mobile number. Null = allowed, else the message.
create function _staff_phone_role_error(p_role staff_role, p_phone text) returns text
language sql immutable as $$
  select case when p_role = 'technician' and not _is_my_mobile(p_phone)
              then 'A technician needs a Malaysian mobile number for WhatsApp, for example 012-345 6789' end;
$$;

-- Another active staff member with this phone number (or null).
create function _staff_phone_taken_by(p_staff_id uuid, p_phone text) returns text
language sql stable
security definer
set search_path = public, pg_temp
as $$
  select s.name from staff s
   where s.active and s.phone = p_phone and s.id is distinct from p_staff_id
   order by s.name limit 1;
$$;

-- Another staff member (active or not) with this email (or null).
create function _staff_email_taken_by(p_staff_id uuid, p_email text) returns text
language sql stable
security definer
set search_path = public, pg_temp
as $$
  select s.name from staff s
   where lower(s.email) = lower(p_email) and s.id is distinct from p_staff_id
   order by s.name limit 1;
$$;

-- A technician's open jobs: Assigned, Acknowledged, In Progress.
create function _staff_open_job_count(p_staff_id uuid) returns integer
language sql stable
security definer
set search_path = public, pg_temp
as $$
  select count(*)::integer from orders o
   where o.assigned_technician_id = p_staff_id
     and o.status in ('assigned', 'acknowledged', 'in_progress');
$$;

create function _staff_open_jobs_error(p_name text, p_count integer) returns text
language sql immutable as $$
  select case when p_count > 0 then
    format('%s has %s open job%s. Reassign %s first.', p_name, p_count,
      case when p_count = 1 then '' else 's' end,
      case when p_count = 1 then 'it' else 'them' end) end;
$$;

-- Losing the last active Admin / Finance user. Null = allowed, else the message.
create function _staff_last_role_error(p_old staff, p_new staff) returns text
language plpgsql stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_label text;
begin
  if p_old.id is null or not p_old.active or p_old.role not in ('admin', 'finance') then
    return null;
  end if;
  if p_new.active and p_new.role = p_old.role then
    return null;
  end if;
  if exists (select 1 from staff s where s.active and s.role = p_old.role and s.id <> p_old.id) then
    return null;
  end if;
  v_label := case p_old.role when 'admin' then 'Admin' else 'Finance user' end;
  return format('%s is the last active %s. Add another %s first.', p_old.name, v_label, v_label);
end;
$$;

-- Does a branch still have an active covering Manager / other active staff
-- once p_new replaces p_old? The first problem, or null. Same rule as the 0004
-- commit check, with a message that names the fix.
create function _staff_cover_error(p_old staff, p_new staff) returns text
language plpgsql stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_branches uuid[] := '{}';
  v_branch   uuid;
  v_name     text;
  v_manager  boolean;
  v_others   boolean;
begin
  if p_old.id is not null then
    v_branches := v_branches || p_old.branch_id || p_old.additional_branch_ids;
  end if;
  v_branches := v_branches || p_new.branch_id || coalesce(p_new.additional_branch_ids, '{}');

  foreach v_branch in array v_branches loop
    continue when v_branch is null;
    v_manager := exists (
        select 1 from staff s
         where s.id is distinct from p_old.id
           and s.role = 'manager' and s.active
           and (s.branch_id = v_branch or v_branch = any (s.additional_branch_ids)))
      or (p_new.role = 'manager' and p_new.active
          and (p_new.branch_id = v_branch or v_branch = any (coalesce(p_new.additional_branch_ids, '{}'))));
    v_others := exists (
        select 1 from staff s
         where s.id is distinct from p_old.id
           and s.active and s.role <> 'manager' and s.branch_id = v_branch)
      or (p_new.role <> 'manager' and p_new.active and p_new.branch_id = v_branch);
    if v_others and not v_manager then
      v_name := coalesce((select name from branches where id = v_branch), 'This branch');
      if p_old.id is not null and _covers_branch(p_old, v_branch) then
        return format('%s is the only Manager covering %s. Give another Manager cover of %s first.',
          p_old.name, v_name, v_name);
      end if;
      return _branch_no_manager_error(v_branch);
    end if;
  end loop;
  return null;
end;
$$;

-- Who may make this change (p_old is empty when adding). Null = allowed.
create function _staff_manage_error(p_actor staff, p_old staff, p_new staff) returns text
language plpgsql stable
security definer
set search_path = public, pg_temp
as $$
begin
  if p_actor.role = 'admin' then
    return null;
  end if;
  if p_actor.role <> 'manager' then
    return 'Only Admins and Managers can manage staff';
  end if;
  if p_old.id is not null then
    if p_old.role <> 'technician' then
      return 'Managers can only manage technicians';
    end if;
    if not _covers_branch(p_actor, p_old.branch_id) then
      return format('Only a Manager of %s can manage %s',
        (select name from branches where id = p_old.branch_id), p_old.name);
    end if;
  end if;
  if p_new.role is distinct from 'technician' then
    return case when p_old.id is null then 'Managers can only add technicians'
                else 'Only an Admin can change a role' end;
  end if;
  -- The email is the sign-in: changing it, then sending a reset, would hand
  -- the technician's sign-in to whoever owns the new address.
  if p_old.id is not null and p_new.email is not null and lower(p_new.email) <> lower(p_old.email) then
    return 'Only an Admin can change an email';
  end if;
  if cardinality(coalesce(p_new.additional_branch_ids, '{}')) > 0 then
    return 'Only an Admin can change branch cover';
  end if;
  if p_new.branch_id is not null and not _covers_branch(p_actor, p_new.branch_id) then
    return format('You do not cover %s. Choose one of your branches.',
      (select name from branches where id = p_new.branch_id));
  end if;
  return null;
end;
$$;

-- Every reason this change cannot be saved, as (field, message), in the
-- order they are checked. The RPCs raise the first; staff_form_check shows
-- them all before saving. p_new.phone must already be in stored form.
create function _staff_change_errors(p_actor staff, p_old staff, p_new staff)
returns table (field text, message text)
language plpgsql stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_text  text;
  v_count integer;
begin
  v_text := _staff_manage_error(p_actor, p_old, p_new);
  if v_text is not null then
    field := 'form'; message := v_text; return next;
    return;
  end if;

  if p_old.id is not null and p_old.id = p_actor.id then
    if p_new.role is distinct from p_old.role then
      field := 'role'; message := 'You cannot change your own role'; return next;
    end if;
    if not p_new.active then
      field := 'active'; message := 'You cannot deactivate yourself'; return next;
    end if;
  end if;

  if p_new.active then
    v_text := _staff_phone_role_error(p_new.role, p_new.phone);
    if v_text is not null then
      field := 'phone'; message := v_text; return next;
    end if;
    v_text := _staff_phone_taken_by(p_new.id, p_new.phone);
    if v_text is not null then
      field := 'phone'; message := format('This phone number is already used by %s', v_text); return next;
    end if;
  end if;

  if p_new.email is not null then
    v_text := _staff_email_taken_by(p_new.id, p_new.email);
    if v_text is not null then
      field := 'email'; message := format('This email is already used by %s', v_text); return next;
    end if;
  end if;

  if p_old.id is not null and p_old.role = 'technician' and p_old.active
     and (not p_new.active or p_new.role <> 'technician') then
    v_count := _staff_open_job_count(p_old.id);
    if v_count > 0 then
      field := case when p_new.active then 'role' else 'active' end;
      message := _staff_open_jobs_error(p_old.name, v_count);
      return next;
    end if;
  end if;

  v_text := _staff_last_role_error(p_old, p_new);
  if v_text is not null then
    field := case when p_new.active then 'role' else 'active' end; message := v_text; return next;
  end if;

  v_text := _staff_cover_error(p_old, p_new);
  if v_text is not null then
    field := case when not p_new.active then 'active'
                  when p_old.id is not null and p_new.branch_id is distinct from p_old.branch_id then 'branch'
                  when p_old.id is not null and p_new.role is distinct from p_old.role then 'role'
                  when p_old.id is null then 'branch'
                  else 'cover' end;
    message := v_text;
    return next;
  end if;
end;
$$;

-- The data rules on every staff insert / update, whoever makes it.
create function staff_rules_check() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_text  text;
  v_count integer;
begin
  if tg_op = 'INSERT' or new.phone is distinct from old.phone then
    if _normalize_my_phone(new.phone) <> new.phone then
      raise exception 'Store the phone number as digits with the country code (for example 60123456789)';
    end if;
  end if;

  if new.active and (tg_op = 'INSERT' or new.phone is distinct from old.phone
                     or new.role is distinct from old.role or not old.active) then
    v_text := _staff_phone_role_error(new.role, new.phone);
    if v_text is not null then
      raise exception '%', v_text;
    end if;
    v_text := _staff_phone_taken_by(new.id, new.phone);
    if v_text is not null then
      raise exception 'This phone number is already used by %', v_text;
    end if;
  end if;

  if tg_op = 'INSERT' or lower(new.email) is distinct from lower(old.email) then
    v_text := _staff_email_taken_by(new.id, new.email);
    if v_text is not null then
      raise exception 'This email is already used by %', v_text;
    end if;
  end if;

  if tg_op = 'UPDATE' and old.role = 'technician' and old.active
     and (not new.active or new.role <> 'technician') then
    v_count := _staff_open_job_count(old.id);
    if v_count > 0 then
      raise exception '%', _staff_open_jobs_error(old.name, v_count);
    end if;
  end if;
  return new;
end;
$$;

create trigger staff_rules_trg
  before insert or update on staff
  for each row execute function staff_rules_check();

-- left_at follows active.
create function staff_left_at() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.left_at := case when new.active then null else coalesce(new.left_at, now()) end;
  elsif new.active is distinct from old.active then
    new.left_at := case when new.active then null else now() end;
  end if;
  return new;
end;
$$;

create trigger staff_left_at_trg
  before insert or update on staff
  for each row execute function staff_left_at();

-- One phone per active staff member (the trigger gives the friendly message;
-- this index holds even under concurrent saves).
create unique index staff_active_phone_key on staff (phone) where active;

-- The last active Admin / Finance user stays (checked at commit, so a
-- replacement can be added in the same transaction).
create function staff_last_role_check() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_label text;
begin
  if old.active and old.role in ('admin', 'finance') then
    -- One check at a time per role: two people deactivating each other at once
    -- must not both see the other still active.
    perform pg_advisory_xact_lock(hashtext('staff_last_role:' || old.role::text));
  end if;
  if old.active and old.role in ('admin', 'finance')
     and not exists (select 1 from staff s where s.active and s.role = old.role) then
    v_label := case old.role when 'admin' then 'Admin' else 'Finance user' end;
    raise exception '% is the last active %. Add another % first.', old.name, v_label, v_label;
  end if;
  return null;
end;
$$;

create constraint trigger staff_last_role_trg
  after update or delete on staff
  deferrable initially deferred
  for each row execute function staff_last_role_check();

-- ---------------------------------------------------------------------------
-- Sign-in state (from Supabase Auth): none (no sign-in yet), invite_pending
-- (invited, no password set yet) or ready.
-- ---------------------------------------------------------------------------
create function _staff_sign_in_state(p_auth_user_id uuid) returns text
language sql stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when p_auth_user_id is null then 'none'
    when not exists (select 1 from auth.users u where u.id = p_auth_user_id) then 'none'
    when exists (select 1 from auth.users u where u.id = p_auth_user_id and u.email_confirmed_at is null)
      then 'invite_pending'
    else 'ready'
  end;
$$;

-- ---------------------------------------------------------------------------
-- Writes
-- ---------------------------------------------------------------------------
-- Raise the first reason this change cannot be saved.
create function _staff_require_change(p_actor staff, p_old staff, p_new staff) returns void
language plpgsql as $$
declare
  v_message text;
begin
  select e.message into v_message from _staff_change_errors(p_actor, p_old, p_new) e limit 1;
  if v_message is not null then
    raise exception '%', v_message;
  end if;
end;
$$;

-- What the server function needs after a write.
create type staff_access_target as (
  staff_id       uuid,
  name           text,
  email          text,
  previous_email text,
  auth_user_id   uuid,
  active         boolean,
  sign_in_state  text
);

create function _staff_access_target(p_staff staff, p_previous_email text) returns staff_access_target
language sql stable as $$
  select row(p_staff.id, p_staff.name, p_staff.email, p_previous_email, p_staff.auth_user_id,
             p_staff.active, _staff_sign_in_state(p_staff.auth_user_id))::staff_access_target;
$$;

create function _staff_check_branch(p_branch_id uuid) returns void
language plpgsql stable as $$
begin
  if p_branch_id is null or not exists (select 1 from branches where id = p_branch_id) then
    raise exception 'Select a valid branch';
  end if;
end;
$$;

-- Add a staff member (the server function then sends the invite).
create function create_staff(
  p_name                  text,
  p_email                 text,
  p_phone                 text,
  p_role                  staff_role,
  p_branch_id             uuid,
  p_additional_branch_ids uuid[] default '{}'
) returns staff_access_target
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor staff := _require_actor();
  v_none  staff;
  v_new   staff;
  v_error text;
begin
  if p_role is null then
    raise exception 'Choose a role';
  end if;
  v_new.role := p_role;
  v_new.branch_id := p_branch_id;
  v_new.additional_branch_ids := coalesce(p_additional_branch_ids, '{}');
  v_new.active := true;
  v_error := _staff_manage_error(v_actor, v_none, v_new);
  if v_error is not null then
    raise exception '%', v_error;
  end if;

  v_new.name := _check_staff_name(p_name);
  v_new.email := _check_staff_email(p_email);
  v_new.phone := _normalize_my_phone(p_phone);
  perform _staff_check_branch(p_branch_id);
  perform _staff_require_change(v_actor, v_none, v_new);

  insert into staff (name, email, phone, role, branch_id, additional_branch_ids)
  values (v_new.name, v_new.email, v_new.phone, v_new.role, v_new.branch_id, v_new.additional_branch_ids)
  returning * into v_new;
  return _staff_access_target(v_new, null);
end;
$$;

-- Edit a staff member's details, role, home branch and (Admins) cover.
-- p_additional_branch_ids null keeps the current cover; a role other than
-- Manager always has none.
create function update_staff(
  p_staff_id              uuid,
  p_name                  text,
  p_email                 text,
  p_phone                 text,
  p_role                  staff_role,
  p_branch_id             uuid,
  p_additional_branch_ids uuid[] default null
) returns staff_access_target
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor staff := _require_actor();
  v_old   staff;
  v_new   staff;
  v_error text;
begin
  select * into v_old from staff where id = p_staff_id for update;
  if not found then
    raise exception 'Staff member not found';
  end if;
  if p_role is null then
    raise exception 'Choose a role';
  end if;

  v_new := v_old;
  v_new.role := p_role;
  v_new.branch_id := p_branch_id;
  v_new.additional_branch_ids := case
    when p_role <> 'manager' then '{}'
    else coalesce(p_additional_branch_ids, v_old.additional_branch_ids) end;
  v_error := _staff_manage_error(v_actor, v_old, v_new);
  if v_error is not null then
    raise exception '%', v_error;
  end if;

  v_new.name := _check_staff_name(p_name);
  v_new.email := _check_staff_email(p_email);
  v_new.phone := _normalize_my_phone(p_phone);
  perform _staff_check_branch(p_branch_id);
  perform _staff_require_change(v_actor, v_old, v_new);

  update staff
     set name = v_new.name,
         email = v_new.email,
         phone = v_new.phone,
         role = v_new.role,
         branch_id = v_new.branch_id,
         additional_branch_ids = v_new.additional_branch_ids
   where id = v_old.id
   returning * into v_new;
  return _staff_access_target(v_new, v_old.email);
end;
$$;

-- Deactivate / reactivate. Already in that state: no change (the server
-- function may be retrying its sign-in step).
create function set_staff_active(p_staff_id uuid, p_active boolean) returns staff_access_target
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor staff := _require_actor();
  v_old   staff;
  v_new   staff;
begin
  if p_active is null then
    raise exception 'Choose active or inactive';
  end if;
  select * into v_old from staff where id = p_staff_id for update;
  if not found then
    raise exception 'Staff member not found';
  end if;
  v_new := v_old;
  v_new.active := p_active;
  perform _staff_require_change(v_actor, v_old, v_new);
  if v_old.active = p_active then
    return _staff_access_target(v_old, null);
  end if;

  update staff set active = p_active where id = v_old.id returning * into v_new;
  return _staff_access_target(v_new, null);
end;
$$;

-- May the signed-in person run this sign-in step for this staff member?
-- invite (first invite or again), password_reset, email_sync (make the
-- sign-in email match the profile), block (inactive), unblock (active).
create function staff_access_check(p_staff_id uuid, p_action text) returns staff_access_target
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor  staff := _require_actor();
  v_staff  staff;
  v_target staff_access_target;
  v_error  text;
begin
  select * into v_staff from staff where id = p_staff_id;
  if not found then
    raise exception 'Staff member not found';
  end if;
  v_error := _staff_manage_error(v_actor, v_staff, v_staff);
  if v_error is not null then
    raise exception '%', v_error;
  end if;
  v_target := _staff_access_target(v_staff, null);

  if p_action in ('invite', 'password_reset', 'unblock') and not v_staff.active then
    raise exception '% is inactive. Reactivate them first.', v_staff.name;
  end if;
  if p_action = 'block' and v_staff.active then
    raise exception '% is active', v_staff.name;
  end if;
  if p_action = 'invite' and v_target.sign_in_state = 'ready' then
    raise exception '% has already set a password. Send a password reset instead.', v_staff.name;
  end if;
  if p_action = 'password_reset' and v_target.sign_in_state <> 'ready' then
    raise exception '% has not set a password yet. Send the invite again instead.', v_staff.name;
  end if;
  if p_action not in ('invite', 'password_reset', 'email_sync', 'block', 'unblock') then
    raise exception 'Unknown sign-in action: %', p_action;
  end if;
  return v_target;
end;
$$;

-- Record that an invite or a password reset email was sent.
create function staff_access_event(p_staff_id uuid, p_action text) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor staff := _require_actor();
  v_staff staff;
  v_error text;
begin
  if p_action not in ('invite_sent', 'password_reset') then
    raise exception 'Unknown sign-in event: %', p_action;
  end if;
  select * into v_staff from staff where id = p_staff_id;
  if not found then
    raise exception 'Staff member not found';
  end if;
  v_error := _staff_manage_error(v_actor, v_staff, v_staff);
  if v_error is not null then
    raise exception '%', v_error;
  end if;
  insert into staff_history (staff_id, actor_id, action, changes, role, branch_id, active)
  values (v_staff.id, v_actor.id, p_action, jsonb_build_object('email', jsonb_build_object('to', v_staff.email)),
          v_staff.role, v_staff.branch_id, v_staff.active);
end;
$$;

-- The server function links the sign-in it just invited (secret key only).
create function link_invited_staff(p_staff_id uuid, p_auth_user_id uuid) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update staff
     set auth_user_id = p_auth_user_id
   where id = p_staff_id
     and (auth_user_id is null or auth_user_id = p_auth_user_id);
  if not found then
    raise exception 'This staff member is already linked to another sign-in';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------
-- Admins see every staff member; a Manager those whose home branch or cover
-- touches a branch they cover.
create function _staff_visible_to(p_actor staff, p_staff staff) returns boolean
language sql stable as $$
  select p_actor.role = 'admin'
      or (p_actor.role = 'manager'
          and (_covers_branch(p_actor, p_staff.branch_id)
               or exists (select 1 from unnest(p_staff.additional_branch_ids) a(id)
                           where _covers_branch(p_actor, a.id))));
$$;

create function _require_staff_screen() returns staff
language plpgsql as $$
declare
  v_actor staff := _require_actor();
begin
  if v_actor.role not in ('admin', 'manager') then
    raise exception 'Only Admins and Managers can see staff';
  end if;
  return v_actor;
end;
$$;

-- The staff list: search (name, email, phone), role, branch (home or cover),
-- status (active / inactive / all), by name, a page at a time.
create function staff_list(
  p_search    text default null,
  p_role      staff_role default null,
  p_branch_id uuid default null,
  p_status    text default 'active',
  p_limit     integer default 25,
  p_offset    integer default 0
) returns table (
  id                      uuid,
  name                    text,
  email                   text,
  phone                   text,
  role                    staff_role,
  branch_id               uuid,
  branch_name             text,
  additional_branch_ids   uuid[],
  additional_branch_names text[],
  active                  boolean,
  joined_at               timestamptz,
  left_at                 timestamptz,
  sign_in_state           text,
  can_manage              boolean,
  total_count             bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor  staff := _require_staff_screen();
  v_text   text := nullif(replace(replace(replace(btrim(coalesce(p_search, '')), '\', '\\'), '%', '\%'), '_', '\_'), '');
  v_digits text := regexp_replace(coalesce(p_search, ''), '[^0-9]', '', 'g');
  v_phone  text;
begin
  if coalesce(p_status, 'active') not in ('active', 'inactive', 'all') then
    raise exception 'Unknown staff status filter: %', p_status;
  end if;
  -- Typed with a trunk 0 or country code it matches from the start of the
  -- number; otherwise anywhere in it.
  v_phone := case when v_digits ~ '^(60|0)' then '60' || regexp_replace(v_digits, '^(60|0)', '') || '%'
                  else '%' || v_digits || '%' end;
  return query
    select s.id, s.name, s.email, s.phone, s.role, s.branch_id, b.name,
           s.additional_branch_ids, _branch_names(s.additional_branch_ids),
           s.active, s.joined_at, s.left_at, _staff_sign_in_state(s.auth_user_id),
           _staff_manage_error(v_actor, s, s) is null,
           count(*) over ()
      from staff s
      join branches b on b.id = s.branch_id
     where _staff_visible_to(v_actor, s)
       and (v_text is null
            or s.name ilike '%' || v_text || '%'
            or s.email ilike '%' || v_text || '%'
            or (length(v_digits) >= 3 and s.phone like v_phone))
       and (p_role is null or s.role = p_role)
       and (p_branch_id is null or s.branch_id = p_branch_id or p_branch_id = any (s.additional_branch_ids))
       and (coalesce(p_status, 'active') = 'all' or s.active = (coalesce(p_status, 'active') = 'active'))
     order by lower(s.name), s.id
     limit least(greatest(coalesce(p_limit, 25), 1), 100)
    offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

-- One staff member: profile, what the signed-in person may do, open jobs,
-- and history (latest first).
create function staff_detail(p_staff_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor    staff := _require_staff_screen();
  v_staff    staff;
  v_off      staff;
  v_state    text;
  v_can_edit boolean;
  v_blocker  text;
begin
  select * into v_staff from staff where id = p_staff_id;
  if not found or not _staff_visible_to(v_actor, v_staff) then
    raise exception 'Staff member not found';
  end if;
  v_state := _staff_sign_in_state(v_staff.auth_user_id);
  v_can_edit := _staff_manage_error(v_actor, v_staff, v_staff) is null;
  if v_staff.active then
    v_off := v_staff;
    v_off.active := false;
    select e.message into v_blocker from _staff_change_errors(v_actor, v_staff, v_off) e limit 1;
  end if;

  return jsonb_build_object(
    'staff', jsonb_build_object(
      'id', v_staff.id,
      'name', v_staff.name,
      'email', v_staff.email,
      'phone', v_staff.phone,
      'role', v_staff.role,
      'branch_id', v_staff.branch_id,
      'branch_name', (select name from branches where id = v_staff.branch_id),
      'additional_branch_ids', to_jsonb(v_staff.additional_branch_ids),
      'additional_branch_names', to_jsonb(_branch_names(v_staff.additional_branch_ids)),
      'active', v_staff.active,
      'joined_at', v_staff.joined_at,
      'left_at', v_staff.left_at,
      'sign_in_state', v_state),
    'permissions', jsonb_build_object(
      'can_edit', v_can_edit,
      'can_change_role', v_actor.role = 'admin' and v_staff.id <> v_actor.id,
      'can_change_email', v_actor.role = 'admin',
      'can_change_cover', v_actor.role = 'admin',
      'can_deactivate', v_can_edit and v_staff.active and v_staff.id <> v_actor.id,
      'can_reactivate', v_can_edit and not v_staff.active,
      'can_send_invite', v_can_edit and v_staff.active and v_state <> 'ready',
      'can_reset_password', v_can_edit and v_staff.active and v_state = 'ready',
      'deactivate_blocker', v_blocker),
    'open_jobs', coalesce((
      select jsonb_agg(jsonb_build_object(
               'order_id', o.id, 'order_no', o.order_no, 'status', o.status,
               'branch_name', b.name) order by o.order_no)
        from orders o
        join branches b on b.id = o.branch_id
       where o.assigned_technician_id = v_staff.id
         and o.status in ('assigned', 'acknowledged', 'in_progress')), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', h.id, 'action', h.action, 'changes', h.changes,
               'actor_id', h.actor_id, 'actor_name', a.name, 'created_at', h.created_at)
             order by h.id desc)
        from staff_history h
        left join staff a on a.id = h.actor_id
       where h.staff_id = v_staff.id), '[]'::jsonb));
end;
$$;

-- Each branch: its covering Managers, active staff, and whether it has a
-- Manager.
create function branch_cover_overview() returns table (
  branch_id    uuid,
  branch_name  text,
  managers     jsonb,
  active_staff integer,
  has_manager  boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform _require_staff_screen();
  return query
    select b.id, b.name,
           coalesce((
             select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'home', s.branch_id = b.id)
                              order by s.branch_id = b.id desc, s.name)
               from staff s
              where s.role = 'manager' and s.active
                and (s.branch_id = b.id or b.id = any (s.additional_branch_ids))), '[]'::jsonb),
           (select count(*)::integer from staff s where s.active and s.branch_id = b.id),
           _branch_has_manager(b.id)
      from branches b
     order by b.name;
end;
$$;

-- Every reason a staff form cannot be saved yet, as (field, message), so the
-- form warns before Save. p_staff_id null = adding. Nothing is changed.
create function staff_form_check(
  p_staff_id              uuid,
  p_name                  text,
  p_email                 text,
  p_phone                 text,
  p_role                  staff_role,
  p_branch_id             uuid,
  p_additional_branch_ids uuid[] default null,
  p_active                boolean default true
) returns table (field text, message text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor staff := _require_staff_screen();
  v_old   staff;
  v_new   staff;
begin
  if p_staff_id is not null then
    select * into v_old from staff where id = p_staff_id;
    if not found or not _staff_visible_to(v_actor, v_old) then
      raise exception 'Staff member not found';
    end if;
    v_new := v_old;
  end if;
  v_new.role := p_role;
  v_new.branch_id := p_branch_id;
  v_new.additional_branch_ids := case
    when p_role is distinct from 'manager' then '{}'
    else coalesce(p_additional_branch_ids, v_old.additional_branch_ids, '{}') end;
  v_new.active := coalesce(p_active, true);

  begin
    v_new.name := _check_staff_name(p_name);
  exception when raise_exception then
    field := 'name'; message := sqlerrm; return next;
  end;
  begin
    v_new.email := _check_staff_email(p_email);
  exception when raise_exception then
    v_new.email := null;
    field := 'email'; message := sqlerrm; return next;
  end;
  begin
    v_new.phone := _normalize_my_phone(p_phone);
  exception when raise_exception then
    v_new.phone := null;
    field := 'phone'; message := sqlerrm; return next;
  end;
  if p_role is null then
    field := 'role'; message := 'Choose a role'; return next;
    return;
  end if;
  if p_branch_id is null or not exists (select 1 from branches where id = p_branch_id) then
    field := 'branch'; message := 'Select a valid branch'; return next;
    return;
  end if;

  return query select * from _staff_change_errors(v_actor, v_old, v_new) e
                where not (e.field = 'phone' and v_new.phone is null);
end;
$$;

-- ---------------------------------------------------------------------------
-- Inactive tags: the ids behind order_review_summary's staff names
-- (same columns as 0005, three appended).
-- ---------------------------------------------------------------------------
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
  fb.working_well as latest_working_well,
  c.technician_id as completion_technician_id,
  rv.actor_id     as reviewed_by_id,
  cl.actor_id     as closed_by_id
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
  select a.created_at, a.note, a.actor_id, st.name as actor_name from audit_log a
    join staff st on st.id = a.actor_id
   where a.order_id = s.id and a.action = 'reviewed'
   order by a.id desc limit 1) rv on true
left join lateral (
  select a.created_at, a.actor_id, st.name as actor_name from audit_log a
    join staff st on st.id = a.actor_id
   where a.order_id = s.id and a.action = 'closed'
   order by a.id desc limit 1) cl on true
left join lateral (
  select f.rating, f.working_well from customer_feedback f
    join customer_messages fm on fm.id = f.message_id
   where f.order_id = s.id
   order by fm.created_at desc, fm.id desc limit 1) fb on true;

-- ---------------------------------------------------------------------------
-- Live sign-out: a signed-in person reads their own staff row even when
-- inactive (no one else's), and staff joins the Realtime publication.
-- ---------------------------------------------------------------------------
create policy staff_read_own on staff
  for select to authenticated
  using (auth_user_id = auth.uid());

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'staff')
  then
    execute 'alter publication supabase_realtime add table public.staff';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- * staff_history: no client role (read through staff_detail).
-- * authenticated: the staff screen RPCs; the database decides who may do what.
-- * service_role (the server function's secret key): link_invited_staff only.
-- * order_review_summary keeps its grants (select for authenticated).
-- ---------------------------------------------------------------------------
alter table staff_history enable row level security;
revoke all on staff_history from public, anon, authenticated, service_role;
revoke all on type staff_access_target from public;
grant usage on type staff_access_target to authenticated;

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
         'staff_history_append_only', '_branch_names', 'staff_history_record', '_role_label',
         '_check_staff_name', '_check_staff_email', '_staff_phone_role_error',
         '_staff_phone_taken_by', '_staff_email_taken_by', '_staff_open_job_count',
         '_staff_open_jobs_error', '_staff_last_role_error', '_staff_cover_error',
         '_staff_manage_error', '_staff_change_errors', 'staff_rules_check', 'staff_left_at',
         'staff_last_role_check', '_staff_sign_in_state', '_staff_require_change',
         '_staff_access_target', '_staff_check_branch', 'create_staff', 'update_staff',
         'set_staff_active', 'staff_access_check', 'staff_access_event', 'link_invited_staff',
         '_staff_visible_to', '_require_staff_screen', 'staff_list', 'staff_detail',
         'branch_cover_overview', 'staff_form_check')
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', r.sig);
    if r.proname in ('create_staff', 'update_staff', 'set_staff_active', 'staff_access_check',
                     'staff_access_event', 'staff_list', 'staff_detail', 'branch_cover_overview',
                     'staff_form_check') then
      execute format('grant execute on function %s to authenticated', r.sig);
    elsif r.proname = 'link_invited_staff' then
      execute format('grant execute on function %s to service_role', r.sig);
    end if;
  end loop;
end;
$$;
