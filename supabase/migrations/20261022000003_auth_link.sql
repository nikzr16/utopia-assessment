-- 0000 System foundation: link Supabase Auth accounts to staff profiles.
--
-- A staff row and a sign-in account are matched by email (case-insensitive);
-- only accounts with a confirmed email are linked.
-- Accounts are created by the company (public sign-up is off): the login
-- script creates the Supabase Auth user, and the trigger below links it to the
-- staff member automatically. link_staff_accounts() links accounts that already
-- existed, and is run once at the end of this migration.
--
-- Requires Supabase's auth schema (auth.users). Grants are finalised in
-- 20261022000004_access_policies.sql.

-- Fail loudly (instead of silently leaving things unprotected) when the
-- Supabase roles are missing.
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
-- Trigger: a sign-in account links itself to the staff row with its email, when
-- it is created confirmed or when its email gets confirmed.
-- SECURITY DEFINER so it can write staff regardless of who inserts the user.
-- ---------------------------------------------------------------------------
create function _link_staff_on_signup() returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Only a confirmed email may claim a staff profile: an unconfirmed
  -- self-registration with a staff member's address must not take it over.
  if new.email is not null and new.email_confirmed_at is not null then
    update staff
       set auth_user_id = new.id
     where auth_user_id is null
       and lower(email) = lower(new.email);
  end if;
  return new;
end;
$$;

create trigger link_staff_on_signup_trg
  after insert or update of email_confirmed_at on auth.users
  for each row execute function _link_staff_on_signup();

-- ---------------------------------------------------------------------------
-- Backfill: link every unlinked staff member whose email matches an existing
-- sign-in account. Returns how many staff rows were linked. Only the service
-- role (the login script) may call it.
-- ---------------------------------------------------------------------------
create function link_staff_accounts() returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_linked integer;
begin
  update staff s
     set auth_user_id = u.id
    from auth.users u
   where s.auth_user_id is null
     and u.email_confirmed_at is not null
     and lower(u.email) = lower(s.email)
     and not exists (select 1 from staff x where x.auth_user_id = u.id);
  get diagnostics v_linked = row_count;
  return v_linked;
end;
$$;

-- Postgres (and Supabase's default privileges) would let other roles execute
-- these; take that away explicitly.
revoke all on function _link_staff_on_signup() from public, anon, authenticated, service_role;
revoke all on function link_staff_accounts() from public, anon, authenticated, service_role;
grant execute on function link_staff_accounts() to service_role;

-- Link accounts that already exist (for example when this migration is applied
-- to a project whose staff have signed-in accounts already).
select link_staff_accounts();
