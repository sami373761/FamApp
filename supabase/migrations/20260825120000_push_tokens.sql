-- =============================================================================
-- Push notification registration
--
-- `profiles.push_token` holds one Expo push token — the address of the device
-- this member last enabled notifications on. It is nullable because "not
-- registered" is the normal state: the Notifications switch is device-local
-- (`PreferencesContext`), so a member who has never turned it on, turned it
-- off, or is signed in on the web has no token, and the column says so rather
-- than storing an empty string.
--
-- One column, therefore one device. That is a real limit and it is deliberate
-- for now: a member signed in on two phones keeps only the token of whichever
-- one registered last. Supporting both means a `push_tokens` child table keyed
-- on (user_id, token), which is a schema this app has no sender for yet — there
-- is no Edge Function or cron job that reads this column at all. Adding the
-- table before anything sends would be inventing structure for a feature that
-- does not exist; adding the column is what lets the switch stop being a
-- device-local flag with nothing behind it.
--
-- READ EXPOSURE — worth stating plainly, because it is not obvious:
-- `profiles: read own and family` is family-wide, and the grants on `profiles`
-- are table-level, so **every member of your family can read your push token**.
-- An Expo push token is a send capability: whoever holds it can push a
-- notification to that device through Expo's public API. That is inside the
-- trust boundary this app already draws (family members can read each other's
-- exact coordinates), but it is a wider boundary than a credential deserves.
-- Closing it means either column-level privileges — `revoke select (push_token)
-- ... from authenticated`, which breaks every `select *` in `familyService` and
-- so needs explicit column lists first — or moving tokens to their own table
-- with an own-row-only policy. Neither is done here; do one of them before
-- anything actually sends a push.
--
-- What *is* closed here is the write side. `profiles: admin updates members`
-- lets a family admin update another member's row, which without a guard would
-- let them point a member's notifications at a device of their choosing. The
-- guard below makes the token writable only by the account that owns it.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Column
--
-- Untyped `text` rather than a check constraint on the `ExponentPushToken[...]`
-- shape: the format is Expo's to change, and a row rejected at write time would
-- surface as a failed switch rather than as a token that simply does not
-- deliver. The client is the only thing that knows what it asked Expo for.
-- -----------------------------------------------------------------------------
alter table public.profiles
  add column if not exists push_token text;

comment on column public.profiles.push_token is
  'Expo push token for the device this member last enabled notifications on, or NULL when they have none. Readable by the whole family (see the migration header); writable only by the owner.';


-- -----------------------------------------------------------------------------
-- 2. Write guard
--
-- `private.guard_profile_columns()` is a denylist of columns a member does not
-- own, so a new column is writable by default — and `profiles: admin updates
-- members` means "by default" includes any admin in the family. Recreated in
-- full rather than patched, because a plpgsql body cannot be amended in place.
-- Everything above the new clause is unchanged from
-- 20260730120000_init_famapp_schema.sql.
-- -----------------------------------------------------------------------------
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

  -- A push token is the address of somebody's phone, and an admin has an
  -- UPDATE policy over every member of their family. Only the device that
  -- obtained the token may store it.
  if new.push_token is distinct from old.push_token and new.id <> (select auth.uid()) then
    raise exception 'A push token can only be set by the device it belongs to.' using errcode = '42501';
  end if;

  return new;
end;
$fn$;

-- The trigger itself is unchanged and already points at this function; it is
-- restated so the migration stands alone if the original is ever reordered.
drop trigger if exists profiles_guard_columns on public.profiles;
create trigger profiles_guard_columns
  before update on public.profiles
  for each row execute function private.guard_profile_columns();
