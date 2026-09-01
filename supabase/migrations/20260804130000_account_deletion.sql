-- =============================================================================
-- FamApp — account deletion
--
-- "Delete account" has to remove the `auth.users` row, and nothing holding only
-- the publishable key can do that: `auth.users` is not exposed through the Data
-- API, and no policy would help if it were. So deletion is a SECURITY DEFINER
-- RPC, the same shape as the three membership functions.
--
-- The delete itself is one statement; what hangs off it is the whole migration.
-- `families.created_by` references `auth.users (id) on delete cascade`, so
-- deleting the creator of a family that still has members would take the family
-- — and every message, task and location in it — with them. Ownership is
-- therefore handed over *before* the user row goes, and a family is only
-- deleted when the account leaving is the last member in it.
--
-- Everything the account itself owns is meant to go: `profiles` cascades from
-- `auth.users`, and that member's messages, created tasks and location row
-- cascade from `profiles`. Tasks merely assigned to them survive with
-- `assigned_to` set to NULL.
-- =============================================================================


create or replace function public.delete_account()
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid    uuid := (select auth.uid());
  v_family uuid;
  v_owned  uuid;
  v_heir   uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated.' using errcode = '28000';
  end if;

  select p.family_id into v_family
    from public.profiles p
   where p.id = v_uid;

  -- 1. Families this account created.
  --
  -- Normally zero or one, but a member who created a family and later left
  -- still owns it as far as the foreign key is concerned, so this is a loop
  -- rather than a single lookup — every one of them would otherwise be
  -- cascade-deleted along with the user row.
  for v_owned in
    select f.id from public.families f where f.created_by = v_uid
  loop
    select p.id into v_heir
      from public.profiles p
     where p.family_id = v_owned
       and p.id <> v_uid
     order by p.is_admin desc, p.created_at asc
     limit 1;

    if v_heir is null then
      -- Nobody left to inherit it. Messages, tasks and locations cascade from
      -- the family; the remaining profiles rows (none) would be set NULL.
      delete from public.families f where f.id = v_owned;
    else
      -- An heir has to be able to administer what they have just been handed.
      update public.profiles set is_admin = true where id = v_heir and not is_admin;
      update public.families  set created_by = v_heir where id = v_owned;
    end if;
  end loop;

  -- 2. A family the account merely belongs to must not be left with no admin —
  --    otherwise nobody could ever remove a member from it again.
  if v_family is not null
     and exists (select 1 from public.families f where f.id = v_family)
     and not exists (
       select 1
         from public.profiles p
        where p.family_id = v_family
          and p.id <> v_uid
          and p.is_admin
     )
  then
    select p.id into v_heir
      from public.profiles p
     where p.family_id = v_family
       and p.id <> v_uid
     order by p.created_at asc
     limit 1;

    if v_heir is not null then
      update public.profiles set is_admin = true where id = v_heir;
    end if;
  end if;

  -- 3. The account. `guard_profile_columns()` skips the updates above because
  --    `current_user` inside a SECURITY DEFINER body is the function owner, the
  --    same reason `remove_member()` can clear someone's family_id.
  delete from auth.users u where u.id = v_uid;
end;
$fn$;

comment on function public.delete_account() is
  'Deletes the calling user''s account. Hands any family they created to the longest-standing remaining admin (or member) first, and deletes families they were the last member of.';


-- -----------------------------------------------------------------------------
-- Privileges
--
-- Supabase's default privileges for `public` were revoked from `anon` in
-- 20260730120300_harden_role_privileges.sql; both statements are stated anyway
-- so this function's grants do not depend on migration order.
-- -----------------------------------------------------------------------------
revoke all on function public.delete_account() from public, anon;
grant execute on function public.delete_account() to authenticated;
