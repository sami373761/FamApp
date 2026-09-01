-- =============================================================================
-- FamApp — member identity
--
-- `families` had no display name and `profiles` had neither a name nor an
-- avatar colour, so `create-family` collected all three and discarded them and
-- every screen fell back to fixtures. These columns are what let the tabs read
-- real rows.
--
-- Both profile columns are deliberately left out of `guard_profile_columns()`:
-- a member is allowed to set their own name and colour. The family name is
-- covered by the existing "families: creator updates" policy.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Columns
-- -----------------------------------------------------------------------------
alter table public.families
  add column if not exists name text;

alter table public.families
  drop constraint if exists families_name_length;
alter table public.families
  add constraint families_name_length
  check (name is null or char_length(btrim(name)) between 1 and 60);

comment on column public.families.name is
  'Display name chosen at creation. NULL for families created before this migration.';


alter table public.profiles
  add column if not exists display_name text;

alter table public.profiles
  add column if not exists color_index smallint not null default 0;

alter table public.profiles
  drop constraint if exists profiles_display_name_length;
alter table public.profiles
  add constraint profiles_display_name_length
  check (display_name is null or char_length(btrim(display_name)) between 1 and 40);

-- Wider than the palette on purpose: the client takes this modulo the length of
-- `MemberColors`, so adding a swatch must not need a migration.
alter table public.profiles
  drop constraint if exists profiles_color_index_range;
alter table public.profiles
  add constraint profiles_color_index_range
  check (color_index between 0 and 99);

comment on column public.profiles.display_name is
  'How the family sees this member. NULL until they choose one.';
comment on column public.profiles.color_index is
  'Index into the client MemberColors palette; the member''s identity colour.';


-- -----------------------------------------------------------------------------
-- 2. Seed identity from auth metadata
--
-- Google returns `full_name`/`name`; an email sign-up can pass `display_name`
-- in the sign-up options. Whichever is present becomes the initial name.
-- -----------------------------------------------------------------------------
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  insert into public.profiles (id, role, display_name, avatar_config)
  values (
    new.id,
    nullif(new.raw_user_meta_data ->> 'role', ''),
    nullif(
      btrim(
        coalesce(
          new.raw_user_meta_data ->> 'display_name',
          new.raw_user_meta_data ->> 'full_name',
          new.raw_user_meta_data ->> 'name',
          ''
        )
      ),
      ''
    ),
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


-- -----------------------------------------------------------------------------
-- 3. create_family() takes the identity the screen already collects
--
-- Dropped rather than replaced: `create or replace` cannot add a parameter, it
-- would leave the one-argument version behind as an overload and make a call
-- with named arguments ambiguous.
-- -----------------------------------------------------------------------------
drop function if exists public.create_family(varchar);

create function public.create_family(
  p_role         varchar  default null,
  p_name         text     default null,
  p_display_name text     default null,
  p_color_index  smallint default null
)
returns public.families
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid     uuid := (select auth.uid());
  v_family  public.families;
  v_attempt integer := 0;
  v_name    text := nullif(btrim(coalesce(p_name, '')), '');
  v_display text := nullif(btrim(coalesce(p_display_name, '')), '');
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
      insert into public.families (join_code, created_by, name)
      values (private.random_join_code(), v_uid, v_name)
      returning * into v_family;
      exit;
    exception when unique_violation then
      if v_attempt >= 10 then
        raise exception 'Could not allocate a unique join code.' using errcode = 'P0001';
      end if;
    end;
  end loop;

  update public.profiles
     set family_id    = v_family.id,
         is_admin     = true,
         role         = coalesce(p_role, role),
         display_name = coalesce(v_display, display_name),
         color_index  = coalesce(p_color_index, color_index)
   where id = v_uid;

  return v_family;
end;
$fn$;

comment on function public.create_family(varchar, text, text, smallint) is
  'Creates a named family with a generated join code and makes the caller its admin.';


-- -----------------------------------------------------------------------------
-- 4. join_family() carries the joiner's identity too
--
-- Without this a joiner lands in the tabs with no name and the default colour,
-- and has no screen on which to set either.
-- -----------------------------------------------------------------------------
drop function if exists public.join_family(varchar);

create function public.join_family(
  p_join_code    varchar,
  p_display_name text     default null,
  p_color_index  smallint default null,
  p_role         varchar  default null
)
returns public.families
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid     uuid := (select auth.uid());
  v_code    varchar(6) := upper(btrim(p_join_code));
  v_family  public.families;
  v_display text := nullif(btrim(coalesce(p_display_name, '')), '');
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
     set family_id    = v_family.id,
         is_admin     = false,
         role         = coalesce(p_role, role),
         display_name = coalesce(v_display, display_name),
         color_index  = coalesce(p_color_index, color_index)
   where id = v_uid;

  return v_family;
end;
$fn$;

comment on function public.join_family(varchar, text, smallint, varchar) is
  'Adds the caller to the family owning the given join code. Enforces the 10-member cap.';


-- -----------------------------------------------------------------------------
-- 5. Privileges
--
-- Dropping a function drops its grants with it, and Supabase's default
-- privileges for `public` have been revoked from `anon` (see
-- 20260730120300_harden_role_privileges.sql), so both have to be re-stated.
-- -----------------------------------------------------------------------------
revoke all on function public.create_family(varchar, text, text, smallint) from public, anon;
revoke all on function public.join_family(varchar, text, smallint, varchar) from public, anon;

grant execute on function public.create_family(varchar, text, text, smallint) to authenticated;
grant execute on function public.join_family(varchar, text, smallint, varchar) to authenticated;
