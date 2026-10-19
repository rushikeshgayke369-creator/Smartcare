-- =====================================================================
-- SmartCare — Supabase database setup
-- Run this ONCE in: Supabase Dashboard → SQL Editor → New query → Run
--
-- What it does
--   1. Adds the missing columns to your existing "patients" table
--   2. Creates "profiles" (patient / staff roles)  — existing logins become STAFF
--   3. Creates "announcements" (doctor availability + department notices)
--   4. Turns on Row Level Security so patient data is NOT publicly readable
--   5. Adds 3 safe functions the public website uses instead of reading the table
--
-- It does not delete any patient rows. It DOES remove the old policies on
-- "patients" (see step 4) — that is what makes the table private.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. PATIENTS TABLE — new columns
-- ---------------------------------------------------------------------
alter table public.patients add column if not exists user_id  uuid references auth.users(id) on delete set null;
alter table public.patients add column if not exists gender   text;
alter table public.patients add column if not exists reason   text;
alter table public.patients add column if not exists queue_at timestamptz;

alter table public.patients alter column created_at set default now();

-- queue_at = position in the queue. Staff "Skip" moves a patient to the back by updating it.
update public.patients set queue_at = coalesce(created_at, now()) where queue_at is null;
alter table public.patients alter column queue_at set default now();
alter table public.patients alter column queue_at set not null;

-- Token numbers come from a database sequence (no duplicates, even with many users at once).
create sequence if not exists public.patient_token_seq;
select setval(
  'public.patient_token_seq',
  (select coalesce(max(substring(token from '^A-(\d+)$')::int), 0) from public.patients) + 1,
  false
);

create index if not exists patients_queue_idx on public.patients (department, status, queue_at);
create index if not exists patients_user_idx  on public.patients (user_id);


-- ---------------------------------------------------------------------
-- 2. PROFILES — who is a patient and who is staff
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text,
  mobile     text,
  role       text not null default 'patient' check (role in ('patient', 'staff')),
  created_at timestamptz not null default now()
);

-- IMPORTANT: every account that exists RIGHT NOW was created for staff
-- (only staff could log in before), so they become staff here.
-- Patients who sign up AFTER this script become 'patient' automatically.
insert into public.profiles (id, role)
select id, 'staff' from auth.users
on conflict (id) do nothing;

-- New sign-ups always start as 'patient'. The role is NEVER read from user-supplied data.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, mobile, role)
  values (
    new.id,
    left(coalesce(new.raw_user_meta_data->>'full_name', ''), 80),
    left(coalesce(new.raw_user_meta_data->>'mobile', ''), 15),
    'patient'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Helper used by security rules and by the staff pages
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'staff');
$$;
grant execute on function public.is_staff() to anon, authenticated;

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own"   on public.profiles;
drop policy if exists "profiles_select_staff" on public.profiles;
drop policy if exists "profiles_update_own"   on public.profiles;

create policy "profiles_select_own"   on public.profiles for select to authenticated using (id = auth.uid());
create policy "profiles_select_staff" on public.profiles for select to authenticated using (public.is_staff());
create policy "profiles_update_own"   on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- A user may edit only their name/mobile — never their role.
-- (Without these lines any logged-in patient could set their own role to 'staff'.)
revoke all on public.profiles from anon;
revoke insert, update, delete on public.profiles from authenticated;
grant select on public.profiles to authenticated;
grant update (full_name, mobile) on public.profiles to authenticated;


-- ---------------------------------------------------------------------
-- 3. ANNOUNCEMENTS
-- ---------------------------------------------------------------------
create table if not exists public.announcements (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null default 'dept' check (kind in ('doctor', 'dept')),
  message    text not null check (char_length(message) between 5 and 140),
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) default auth.uid()
);

alter table public.announcements enable row level security;

drop policy if exists "announcements_public_read" on public.announcements;
drop policy if exists "announcements_staff_read"  on public.announcements;
drop policy if exists "announcements_staff_write" on public.announcements;

create policy "announcements_public_read" on public.announcements for select to anon, authenticated using (is_active = true);
create policy "announcements_staff_read"  on public.announcements for select to authenticated using (public.is_staff());
create policy "announcements_staff_write" on public.announcements for all    to authenticated
  using (public.is_staff()) with check (public.is_staff());

revoke all on public.announcements from anon;
grant select on public.announcements to anon;
grant select, insert, update, delete on public.announcements to authenticated;


-- ---------------------------------------------------------------------
-- 4. PATIENTS — Row Level Security (this is what keeps records private)
-- ---------------------------------------------------------------------
alter table public.patients enable row level security;

-- Remove every old policy (older versions allowed public/anonymous access).
do $$
declare r record;
begin
  for r in select policyname from pg_policies where schemaname = 'public' and tablename = 'patients' loop
    execute format('drop policy %I on public.patients', r.policyname);
  end loop;
end $$;

-- A patient can read ONLY their own rows. Staff can read and update everything.
create policy "patients_select_own"   on public.patients for select to authenticated using (user_id = auth.uid());
create policy "patients_select_staff" on public.patients for select to authenticated using (public.is_staff());
create policy "patients_update_staff" on public.patients for update to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- No direct inserts/deletes from the browser. New patients are created ONLY through
-- register_patient() below, which validates everything on the server.
revoke all on public.patients from anon;
revoke insert, delete on public.patients from authenticated;
grant select on public.patients to authenticated;
grant update (status, estimated_time, queue_at) on public.patients to authenticated;


-- ---------------------------------------------------------------------
-- 5. PUBLIC FUNCTIONS (no private data leaves the database)
-- ---------------------------------------------------------------------

-- 5a. Public live queue: masked names only — no age, mobile, gender or reason.
create or replace function public.get_public_queue()
returns table (token text, display_name text, department text, status text, queue_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select p.token,
         regexp_replace(trim(p.full_name), '(\S)\S*', '\1***', 'g') as display_name,
         p.department,
         p.status,
         p.queue_at
  from public.patients p
  where p.created_at > now() - interval '24 hours'
  order by p.queue_at asc;
$$;
grant execute on function public.get_public_queue() to anon, authenticated;

-- 5b. Just a number for the "Patients Registered" card.
create or replace function public.get_registered_count()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int from public.patients;
$$;
grant execute on function public.get_registered_count() to anon, authenticated;

-- 5c. Registration: login required, validated on the server, atomic token number.
create or replace function public.register_patient(
  p_full_name  text,
  p_age        integer,
  p_mobile     text,
  p_gender     text,
  p_department text,
  p_reason     text default null
)
returns public.patients
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_name   text := trim(coalesce(p_full_name, ''));
  v_active text;
  v_busy   boolean;
  v_ahead  integer;
  v_seq    bigint;
  v_row    public.patients;
begin
  if v_uid is null then
    raise exception 'Please log in to register a visit.';
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 60 then
    raise exception 'Please enter a valid full name.';
  end if;
  if p_age is null or p_age < 0 or p_age > 120 then
    raise exception 'Enter a valid age between 0 and 120.';
  end if;
  if coalesce(p_mobile, '') !~ '^[6-9][0-9]{9}$' then
    raise exception 'Enter a valid 10-digit mobile number.';
  end if;
  if coalesce(p_gender, '') not in ('Female', 'Male', 'Other') then
    raise exception 'Please select a valid gender.';
  end if;
  if coalesce(p_department, '') not in ('General Medicine', 'Cardiology', 'Dermatology', 'Orthopedics', 'Pediatrics', 'ENT') then
    raise exception 'Please select a valid department.';
  end if;

  -- One lock per department so two people can never both become "Serving".
  perform pg_advisory_xact_lock(hashtext('smartcare_dept_' || p_department));

  select token into v_active
  from public.patients
  where user_id = v_uid
    and department = p_department
    and lower(full_name) = lower(v_name)
    and status in ('Waiting', 'Serving')
    and created_at > now() - interval '24 hours'
  limit 1;
  if v_active is not null then
    raise exception 'This patient already has an active token (%) in %.', v_active, p_department;
  end if;

  select count(*) filter (where status = 'Waiting'),
         count(*) > 0
    into v_ahead, v_busy
  from public.patients
  where department = p_department
    and status in ('Waiting', 'Serving')
    and created_at > now() - interval '24 hours';

  v_seq := nextval('public.patient_token_seq');

  insert into public.patients
    (token, full_name, age, mobile, gender, department, reason, status, estimated_time, user_id)
  values
    ('A-' || lpad(v_seq::text, 3, '0'),
     v_name, p_age, p_mobile, p_gender, p_department,
     left(nullif(trim(coalesce(p_reason, '')), ''), 240),
     case when v_busy then 'Waiting' else 'Serving' end,
     case when v_busy then ((v_ahead + 1) * 5)::text || ' min' else 'Now' end,
     v_uid)
  returning * into v_row;

  return v_row;
end;
$$;

revoke execute on function public.register_patient(text, integer, text, text, text, text) from public, anon;
grant  execute on function public.register_patient(text, integer, text, text, text, text) to authenticated;


-- ---------------------------------------------------------------------
-- 6. REALTIME for the staff dashboard (safe to run more than once)
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'patients'
  ) then
    alter publication supabase_realtime add table public.patients;
  end if;
end $$;


-- ---------------------------------------------------------------------
-- 7. SAFETY INDEXES — run last on purpose.
--    If one fails, old data has duplicates: the error tells you which, fix them,
--    then run just that statement again. Everything above is already applied.
-- ---------------------------------------------------------------------
-- No two patients may share a token.
create unique index if not exists patients_token_key on public.patients (token);

-- At most ONE patient "Serving" per department (stops two staff calling two patients at once).
create unique index if not exists patients_one_serving_per_dept
  on public.patients (department) where status = 'Serving';


-- ---------------------------------------------------------------------
-- HOW TO MAKE SOMEONE STAFF LATER
--   1. Create the user in Authentication → Users (or let them sign up on the patient site)
--   2. Run:   update public.profiles set role = 'staff'
--             where id = (select id from auth.users where email = 'new.staff@example.com');
-- ---------------------------------------------------------------------
-- Lock down legacy tables not used by the current website.
-- Only touches tables that actually exist, so it can never stop the script.
do $$
declare t text;
begin
  foreach t in array array['departments', 'queue', 'staff_users'] loop
    if to_regclass('public.' || t) is not null then
      execute format('revoke all on table public.%I from anon, authenticated', t);
    end if;
  end loop;
end $$;
