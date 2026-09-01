-- =============================================================================
-- FamApp — V4 core schema
--
-- Tables, business-rule triggers, row level security and the three RPCs that
-- own family membership (`create_family` / `join_family` / `remove_member`).
--
-- Data-retention jobs live in the next migration; media storage cleanup is
-- handled by the `cleanup-media` Edge Function.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 0. Private helper schema
--
-- Internal functions the policies and triggers lean on. Not exposed through the
-- Data API. The two RLS lookup helpers land in section 1b rather than here: a
-- SQL function body is validated at creation time, so `profiles` must exist
-- before they can be defined.
-- -----------------------------------------------------------------------------
create schema if not exists private;

revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;


-- Six characters from an alphabet with no visually ambiguous glyphs
-- (no I/1, no O/0) — these codes get read aloud and typed by hand.
create or replace function private.random_join_code()
returns varchar(6)
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  result   text := '';
  i        int;
begin
  for i in 1..6 loop
    result := result || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return result;
end;
$fn$;


revoke all on function private.random_join_code() from public;


-- -----------------------------------------------------------------------------
-- 1. Tables
-- -----------------------------------------------------------------------------

create table if not exists public.families (
  id          uuid        primary key default gen_random_uuid(),
  join_code   varchar(6)  not null unique
              constraint families_join_code_format check (join_code ~ '^[A-Z0-9]{6}$'),
  created_by  uuid        not null references auth.users (id) on delete cascade,
  max_members integer     not null default 10
              constraint families_max_members_range check (max_members between 1 and 10),
  created_at  timestamptz not null default now()
);

comment on table public.families is 'One household. `join_code` is the 6-character code shown on the Join screen.';
comment on column public.families.max_members is 'V4 hard cap: never above 10, enforced again by trigger on profiles.';


create table if not exists public.profiles (
  id                uuid        primary key references auth.users (id) on delete cascade,
  family_id         uuid        references public.families (id) on delete set null,
  role              varchar(30),
  avatar_config     jsonb       not null default '{}'::jsonb,
  is_admin          boolean     not null default false,
  daily_photo_count integer     not null default 0
                    constraint profiles_daily_photo_count_nonneg check (daily_photo_count >= 0),
  created_at        timestamptz not null default now()
);

comment on table public.profiles is 'Public per-user record. Created automatically on auth.users insert.';
comment on column public.profiles.family_id is
  'Set to NULL to leave or be kicked. Joining goes through public.join_family(code), never a direct write.';
comment on column public.profiles.daily_photo_count is
  'Server-managed: incremented by the messages trigger, zeroed nightly by cron.';


create table if not exists public.locations (
  user_id    uuid             primary key references public.profiles (id) on delete cascade,
  family_id  uuid             not null references public.families (id) on delete cascade,
  latitude   double precision not null
             constraint locations_latitude_range check (latitude between -90 and 90),
  longitude  double precision not null
             constraint locations_longitude_range check (longitude between -180 and 180),
  updated_at timestamptz      not null default now()
);

comment on table public.locations is 'Latest known position per member — one row per user, upserted.';


create table if not exists public.messages (
  id           uuid        primary key default gen_random_uuid(),
  family_id    uuid        not null references public.families (id) on delete cascade,
  sender_id    uuid        not null references public.profiles (id) on delete cascade,
  content      text        constraint messages_content_length check (char_length(content) <= 500),
  media_url    text,
  message_type varchar(20) not null
               constraint messages_type_valid check (message_type in ('text', 'image', 'system')),
  created_at   timestamptz not null default now(),

  -- A row must actually carry the payload its type promises.
  constraint messages_payload_matches_type check (
        (message_type = 'text'   and content is not null and media_url is null)
     or (message_type = 'image'  and media_url is not null)
     or (message_type = 'system' and content is not null and media_url is null)
  )
);

comment on column public.messages.media_url is
  'Storage object path inside the `chat-media` bucket: <family_id>/<sender_id>/<uuid>.<ext>. Not a public URL — the bucket is private.';


create table if not exists public.tasks (
  id                uuid        primary key default gen_random_uuid(),
  family_id         uuid        not null references public.families (id) on delete cascade,
  created_by        uuid        not null references public.profiles (id) on delete cascade,
  assigned_to       uuid        references public.profiles (id) on delete set null,
  handled_by        uuid        references public.profiles (id) on delete set null,
  title             text        not null
                    constraint tasks_title_length check (char_length(btrim(title)) between 1 and 200),
  status            varchar(20) not null default 'pending'
                    constraint tasks_status_valid
                    check (status in ('pending', 'in_progress', 'completed', 'expired')),
  duration_type     varchar(20) not null
                    constraint tasks_duration_valid
                    check (duration_type in ('1_day', '1_week', '1_month')),
  expires_at        timestamptz not null,
  source_message_id uuid        references public.messages (id) on delete set null,
  created_at        timestamptz not null default now()
);

comment on column public.tasks.assigned_to is 'NULL means an unclaimed pool task any member can pick up.';
comment on column public.tasks.handled_by  is 'Last member who moved the task between states.';
comment on column public.tasks.expires_at  is 'Derived from duration_type on insert when omitted.';


-- -----------------------------------------------------------------------------
-- 1b. RLS lookup helpers
--
-- Every policy below needs "which family is the caller in?", which means
-- reading `profiles` — the very table some of those policies protect. Inline,
-- that recurses; SECURITY DEFINER breaks the cycle.
-- -----------------------------------------------------------------------------
create or replace function private.current_family_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $fn$
  select p.family_id
    from public.profiles p
   where p.id = (select auth.uid());
$fn$;

comment on function private.current_family_id() is
  'Family of the calling user. SECURITY DEFINER so RLS policies on profiles do not recurse.';


create or replace function private.is_family_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce(p.is_admin, false)
    from public.profiles p
   where p.id = (select auth.uid());
$fn$;

comment on function private.is_family_admin() is
  'True when the calling user is an admin of their own family.';


revoke all on function private.current_family_id(), private.is_family_admin() from public;
grant execute on function private.current_family_id(), private.is_family_admin()
  to authenticated, service_role;


-- -----------------------------------------------------------------------------
-- 2. Indexes
-- -----------------------------------------------------------------------------
create index if not exists profiles_family_id_idx    on public.profiles (family_id) where family_id is not null;

create index if not exists locations_family_id_idx   on public.locations (family_id);

create index if not exists messages_family_time_idx  on public.messages (family_id, created_at desc);
create index if not exists messages_sender_id_idx    on public.messages (sender_id);
-- Drives the retention sweeps, which scan by type + age across all families.
create index if not exists messages_retention_idx    on public.messages (message_type, created_at);

create index if not exists tasks_family_status_idx   on public.tasks (family_id, status);
create index if not exists tasks_assigned_to_idx     on public.tasks (assigned_to) where assigned_to is not null;
create index if not exists tasks_source_message_idx  on public.tasks (source_message_id) where source_message_id is not null;
create index if not exists tasks_expiry_sweep_idx    on public.tasks (expires_at) where status <> 'completed';


-- -----------------------------------------------------------------------------
-- 3. Business rules (V4 constraints)
-- -----------------------------------------------------------------------------

-- 3.1 — A family never exceeds `max_members` (10).
--
-- Locks the families row so two people redeeming the same join code
-- concurrently cannot both slip past the count.
create or replace function private.enforce_family_member_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_max   integer;
  v_count integer;
begin
  if new.family_id is null then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.family_id is not distinct from new.family_id then
    return new;
  end if;

  select f.max_members into v_max
    from public.families f
   where f.id = new.family_id
     for update;

  if v_max is null then
    raise exception 'Family % does not exist', new.family_id using errcode = '23503';
  end if;

  select count(*) into v_count
    from public.profiles p
   where p.family_id = new.family_id
     and p.id <> new.id;

  if v_count >= v_max then
    raise exception 'This family is full (% of % members).', v_count, v_max
      using errcode = 'P0001', hint = 'Ask an admin to remove a member first.';
  end if;

  return new;
end;
$fn$;

drop trigger if exists profiles_enforce_member_limit on public.profiles;
create trigger profiles_enforce_member_limit
  before insert or update of family_id on public.profiles
  for each row execute function private.enforce_family_member_limit();


-- 3.2 — A family never has more than 20 tasks in an active state.
create or replace function private.enforce_active_task_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  max_active constant integer := 20;
  v_count    integer;
begin
  -- Only insert, or an update that moves a task back into an active state.
  if tg_op = 'UPDATE'
     and not (old.status in ('completed', 'expired') and new.status not in ('completed', 'expired'))
  then
    return new;
  end if;

  perform 1 from public.families f where f.id = new.family_id for update;

  select count(*) into v_count
    from public.tasks t
   where t.family_id = new.family_id
     and t.status not in ('completed', 'expired')
     and t.id <> new.id;

  if v_count >= max_active then
    raise exception 'This family already has % active tasks (limit %).', v_count, max_active
      using errcode = 'P0001', hint = 'Complete or delete a task before adding another.';
  end if;

  return new;
end;
$fn$;

drop trigger if exists tasks_enforce_active_limit on public.tasks;
create trigger tasks_enforce_active_limit
  before insert or update of status on public.tasks
  for each row execute function private.enforce_active_task_limit();


-- 3.3 — Keep expires_at consistent with duration_type when the client omits it.
create or replace function private.fill_task_expiry()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if new.expires_at is null then
    new.expires_at := coalesce(new.created_at, now()) + case new.duration_type
      when '1_day'   then interval '1 day'
      when '1_week'  then interval '7 days'
      when '1_month' then interval '1 month'
    end;
  end if;
  return new;
end;
$fn$;

drop trigger if exists tasks_fill_expiry on public.tasks;
create trigger tasks_fill_expiry
  before insert on public.tasks
  for each row execute function private.fill_task_expiry();


-- 3.4 — Photo counter. The nightly reset is only meaningful if something
--       increments it, so the insert side lives here too.
create or replace function private.bump_daily_photo_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if new.message_type = 'image' then
    update public.profiles
       set daily_photo_count = daily_photo_count + 1
     where id = new.sender_id;
  end if;
  return null;
end;
$fn$;

drop trigger if exists messages_bump_photo_count on public.messages;
create trigger messages_bump_photo_count
  after insert on public.messages
  for each row execute function private.bump_daily_photo_count();


-- 3.5 — locations.updated_at is always server time.
create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  new.updated_at := now();
  return new;
end;
$fn$;

drop trigger if exists locations_touch_updated_at on public.locations;
create trigger locations_touch_updated_at
  before insert or update on public.locations
  for each row execute function private.touch_updated_at();


-- 3.6 — Columns a member must not be able to set for themselves.
--
-- Deliberately SECURITY INVOKER: `current_user` then reflects the real caller,
-- so calls arriving through the SECURITY DEFINER RPCs below (which run as the
-- table owner) and through the service role key are trusted and skip the guard,
-- while a direct PostgREST update from `authenticated` is checked.
create or replace function private.guard_profile_columns()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role')
     or (select auth.uid()) is null
  then
    return new;
  end if;

  if new.is_admin is distinct from old.is_admin and not private.is_family_admin() then
    raise exception 'Only a family admin can change admin rights.' using errcode = '42501';
  end if;

  if new.daily_photo_count is distinct from old.daily_photo_count then
    raise exception 'daily_photo_count is managed by the server.' using errcode = '42501';
  end if;

  if new.created_at is distinct from old.created_at then
    raise exception 'created_at is immutable.' using errcode = '42501';
  end if;

  -- Leaving or being kicked (-> NULL) is fine; joining must go through the RPC
  -- so the join code is actually verified.
  if new.family_id is distinct from old.family_id and new.family_id is not null then
    raise exception 'Use join_family(code) to join a family.' using errcode = '42501';
  end if;

  return new;
end;
$fn$;

drop trigger if exists profiles_guard_columns on public.profiles;
create trigger profiles_guard_columns
  before update on public.profiles
  for each row execute function private.guard_profile_columns();


-- 3.7 — Every auth user gets a profile.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  insert into public.profiles (id, role, avatar_config)
  values (
    new.id,
    nullif(new.raw_user_meta_data ->> 'role', ''),
    case
      when jsonb_typeof(new.raw_user_meta_data -> 'avatar_config') = 'object'
        then new.raw_user_meta_data -> 'avatar_config'
      else '{}'::jsonb
    end
  )
  on conflict (id) do nothing;
  return new;
end;
$fn$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();


-- -----------------------------------------------------------------------------
-- 4. Membership RPCs
--
-- RLS hides families you are not a member of, which means a joiner cannot look
-- up a family by its code. Both entry points are therefore SECURITY DEFINER.
-- -----------------------------------------------------------------------------

create or replace function public.create_family(p_role varchar default null)
returns public.families
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid     uuid := (select auth.uid());
  v_family  public.families;
  v_attempt integer := 0;
begin
  if v_uid is null then
    raise exception 'Not authenticated.' using errcode = '28000';
  end if;

  insert into public.profiles (id) values (v_uid) on conflict (id) do nothing;

  if exists (select 1 from public.profiles p where p.id = v_uid and p.family_id is not null) then
    raise exception 'You already belong to a family.'
      using errcode = 'P0001', hint = 'Leave your current family first.';
  end if;

  loop
    v_attempt := v_attempt + 1;
    begin
      insert into public.families (join_code, created_by)
      values (private.random_join_code(), v_uid)
      returning * into v_family;
      exit;
    exception when unique_violation then
      if v_attempt >= 10 then
        raise exception 'Could not allocate a unique join code.' using errcode = 'P0001';
      end if;
    end;
  end loop;

  update public.profiles
     set family_id = v_family.id,
         is_admin  = true,
         role      = coalesce(p_role, role)
   where id = v_uid;

  return v_family;
end;
$fn$;

comment on function public.create_family(varchar) is
  'Creates a family with a generated join code and makes the caller its admin.';


create or replace function public.join_family(p_join_code varchar)
returns public.families
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid    uuid := (select auth.uid());
  v_code   varchar(6) := upper(btrim(p_join_code));
  v_family public.families;
begin
  if v_uid is null then
    raise exception 'Not authenticated.' using errcode = '28000';
  end if;

  insert into public.profiles (id) values (v_uid) on conflict (id) do nothing;

  if exists (select 1 from public.profiles p where p.id = v_uid and p.family_id is not null) then
    raise exception 'You already belong to a family.'
      using errcode = 'P0001', hint = 'Leave your current family first.';
  end if;

  select * into v_family from public.families f where f.join_code = v_code;

  if not found then
    raise exception 'No family found for code %.', v_code using errcode = 'P0002';
  end if;

  -- The member-limit trigger rejects this if the family is already full.
  update public.profiles
     set family_id = v_family.id,
         is_admin  = false
   where id = v_uid;

  return v_family;
end;
$fn$;

comment on function public.join_family(varchar) is
  'Adds the caller to the family owning the given join code. Enforces the 10-member cap.';


-- Kicking cannot be a plain UPDATE.
--
-- Postgres re-checks SELECT policies against the *new* row during an UPDATE.
-- Clearing a member's family_id makes their row invisible to the admin doing
-- the clearing, so the statement is rejected with "new row violates row level
-- security policy" no matter how permissive the UPDATE policy is. The admin
-- UPDATE policy still covers ordinary edits (role, avatar); removal goes here.
create or replace function public.remove_member(p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid    uuid := (select auth.uid());
  v_family uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated.' using errcode = '28000';
  end if;

  select p.family_id into v_family
    from public.profiles p
   where p.id = v_uid
     and p.is_admin
     and p.family_id is not null;

  if v_family is null then
    raise exception 'Only a family admin can remove members.' using errcode = '42501';
  end if;

  if p_member_id = v_uid then
    raise exception 'Admins cannot remove themselves.'
      using errcode = 'P0001', hint = 'Clear your own family_id to leave the family.';
  end if;

  update public.profiles
     set family_id = null,
         is_admin  = false
   where id = p_member_id
     and family_id = v_family;

  if not found then
    raise exception 'That member is not in your family.' using errcode = 'P0002';
  end if;
end;
$fn$;

comment on function public.remove_member(uuid) is
  'Admin-only: removes a member from the caller''s family. Members leave by setting their own family_id to NULL.';


revoke all on function
  public.create_family(varchar), public.join_family(varchar), public.remove_member(uuid)
from public;
grant execute on function
  public.create_family(varchar), public.join_family(varchar), public.remove_member(uuid)
to authenticated;


-- -----------------------------------------------------------------------------
-- 5. Privileges
--
-- New tables in `public` are no longer auto-exposed to the Data API roles, so
-- the grants below are what make the tables reachable at all. RLS then decides
-- which rows. `families` has no INSERT grant on purpose: create_family() is the
-- only way in.
-- -----------------------------------------------------------------------------
grant select, update, delete         on public.families  to authenticated;
grant select, insert, update, delete on public.profiles  to authenticated;
grant select, insert, update, delete on public.locations to authenticated;
grant select, insert, update, delete on public.messages  to authenticated;
grant select, insert, update, delete on public.tasks     to authenticated;


-- -----------------------------------------------------------------------------
-- 6. Row level security
-- -----------------------------------------------------------------------------
alter table public.families  enable row level security;
alter table public.profiles  enable row level security;
alter table public.locations enable row level security;
alter table public.messages  enable row level security;
alter table public.tasks     enable row level security;

-- 6.1 families -----------------------------------------------------------------
drop policy if exists "families: members read own family"   on public.families;
drop policy if exists "families: creator updates"           on public.families;
drop policy if exists "families: creator deletes"           on public.families;

create policy "families: members read own family"
  on public.families for select to authenticated
  using (id = (select private.current_family_id()));

create policy "families: creator updates"
  on public.families for update to authenticated
  using      (created_by = (select auth.uid()))
  with check (created_by = (select auth.uid()));

create policy "families: creator deletes"
  on public.families for delete to authenticated
  using (created_by = (select auth.uid()));

-- 6.2 profiles -----------------------------------------------------------------
drop policy if exists "profiles: read own and family"       on public.profiles;
drop policy if exists "profiles: insert own"                on public.profiles;
drop policy if exists "profiles: update own"                on public.profiles;
drop policy if exists "profiles: admin updates members"     on public.profiles;
drop policy if exists "profiles: delete own"                on public.profiles;

create policy "profiles: read own and family"
  on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or (family_id is not null and family_id = (select private.current_family_id()))
  );

create policy "profiles: insert own"
  on public.profiles for insert to authenticated
  with check (
    id = (select auth.uid())
    and family_id is null
    and is_admin = false
    and daily_photo_count = 0
  );

create policy "profiles: update own"
  on public.profiles for update to authenticated
  using      (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Ordinary admin edits to a member (role, avatar_config). Removal is NOT
-- possible here — see public.remove_member() for why.
create policy "profiles: admin updates members"
  on public.profiles for update to authenticated
  using (
    (select private.is_family_admin())
    and family_id is not null
    and family_id = (select private.current_family_id())
  )
  with check (
    (select private.is_family_admin())
    and (family_id is null or family_id = (select private.current_family_id()))
  );

create policy "profiles: delete own"
  on public.profiles for delete to authenticated
  using (id = (select auth.uid()));

-- 6.3 locations ----------------------------------------------------------------
drop policy if exists "locations: family reads"   on public.locations;
drop policy if exists "locations: insert own"     on public.locations;
drop policy if exists "locations: update own"     on public.locations;
drop policy if exists "locations: delete own"     on public.locations;

create policy "locations: family reads"
  on public.locations for select to authenticated
  using (family_id = (select private.current_family_id()));

create policy "locations: insert own"
  on public.locations for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and family_id = (select private.current_family_id())
  );

create policy "locations: update own"
  on public.locations for update to authenticated
  using      (user_id = (select auth.uid()) and family_id = (select private.current_family_id()))
  with check (user_id = (select auth.uid()) and family_id = (select private.current_family_id()));

create policy "locations: delete own"
  on public.locations for delete to authenticated
  using (user_id = (select auth.uid()));

-- 6.4 messages -----------------------------------------------------------------
drop policy if exists "messages: family reads"        on public.messages;
drop policy if exists "messages: send as self"        on public.messages;
drop policy if exists "messages: edit own"            on public.messages;
drop policy if exists "messages: delete own or admin" on public.messages;

create policy "messages: family reads"
  on public.messages for select to authenticated
  using (family_id = (select private.current_family_id()));

create policy "messages: send as self"
  on public.messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and family_id = (select private.current_family_id())
  );

create policy "messages: edit own"
  on public.messages for update to authenticated
  using      (sender_id = (select auth.uid()) and family_id = (select private.current_family_id()))
  with check (sender_id = (select auth.uid()) and family_id = (select private.current_family_id()));

create policy "messages: delete own or admin"
  on public.messages for delete to authenticated
  using (
    family_id = (select private.current_family_id())
    and (sender_id = (select auth.uid()) or (select private.is_family_admin()))
  );

-- 6.5 tasks --------------------------------------------------------------------
-- Tasks are collaborative: any member may claim, hand over or complete any task
-- in their family, so isolation is purely on family_id.
drop policy if exists "tasks: family reads"   on public.tasks;
drop policy if exists "tasks: family inserts" on public.tasks;
drop policy if exists "tasks: family updates" on public.tasks;
drop policy if exists "tasks: family deletes" on public.tasks;

create policy "tasks: family reads"
  on public.tasks for select to authenticated
  using (family_id = (select private.current_family_id()));

create policy "tasks: family inserts"
  on public.tasks for insert to authenticated
  with check (
    family_id = (select private.current_family_id())
    and created_by = (select auth.uid())
  );

create policy "tasks: family updates"
  on public.tasks for update to authenticated
  using      (family_id = (select private.current_family_id()))
  with check (family_id = (select private.current_family_id()));

create policy "tasks: family deletes"
  on public.tasks for delete to authenticated
  using (family_id = (select private.current_family_id()));


-- -----------------------------------------------------------------------------
-- 7. Chat media bucket
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-media',
  'chat-media',
  false,
  10485760,  -- 10 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do nothing;

-- Object key convention: <family_id>/<user_id>/<uuid>.<ext>
drop policy if exists "chat-media: family reads"        on storage.objects;
drop policy if exists "chat-media: upload to own path"  on storage.objects;
drop policy if exists "chat-media: delete own or admin" on storage.objects;

create policy "chat-media: family reads"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'chat-media'
    and (storage.foldername(name))[1] = (select private.current_family_id())::text
  );

create policy "chat-media: upload to own path"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'chat-media'
    and (storage.foldername(name))[1] = (select private.current_family_id())::text
    and (storage.foldername(name))[2] = (select auth.uid())::text
  );

create policy "chat-media: delete own or admin"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'chat-media'
    and (storage.foldername(name))[1] = (select private.current_family_id())::text
    and (
      (storage.foldername(name))[2] = (select auth.uid())::text
      or (select private.is_family_admin())
    )
  );


-- -----------------------------------------------------------------------------
-- 8. Realtime
--
-- REPLICA IDENTITY FULL so subscribers receive the old row on delete — the chat
-- and task lists need it to remove the right item.
-- -----------------------------------------------------------------------------
alter table public.messages  replica identity full;
alter table public.tasks     replica identity full;

do $realtime$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
    ) then
      alter publication supabase_realtime add table public.messages;
    end if;

    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tasks'
    ) then
      alter publication supabase_realtime add table public.tasks;
    end if;

    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'locations'
    ) then
      alter publication supabase_realtime add table public.locations;
    end if;

    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profiles'
    ) then
      alter publication supabase_realtime add table public.profiles;
    end if;
  end if;
end;
$realtime$;
