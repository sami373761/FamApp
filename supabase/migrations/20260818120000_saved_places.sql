-- =============================================================================
-- Saved places
--
-- A family's named coordinates: home, school, work, leisure, park. They exist
-- so the app can say "Sami at Mehmet's Home" instead of a pair of decimals —
-- the first place *name* the schema has ever been able to supply, and therefore
-- the only one the UI is allowed to render.
--
-- Two rules are carried by constraints rather than by client code, for the same
-- reason the 10-member and 20-task ceilings are:
--
--   * `unique (user_id, category)` — one place per category per member, which
--     is also what caps a member at five saved places. There is no count
--     trigger because the category list *is* the ceiling.
--   * the category check — the five values the UI draws an icon for. Anything
--     else would reach a screen with no icon and no label.
--
-- There is no proximity or visit log here on purpose. "Who is at which place"
-- is a distance between two rows the client already holds, recomputed whenever
-- either changes; storing it would mean a table that is wrong the moment a
-- position moves.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Table
-- -----------------------------------------------------------------------------
create table if not exists public.saved_places (
  id         uuid             primary key default gen_random_uuid(),
  family_id  uuid             not null references public.families (id) on delete cascade,
  user_id    uuid             not null references public.profiles (id) on delete cascade,
  category   text             not null
             constraint saved_places_category_valid
             check (category in ('home', 'school', 'work', 'leisure', 'park')),
  title      varchar(40)      not null
             constraint saved_places_title_length
             check (char_length(btrim(title)) between 1 and 40),
  latitude   double precision not null
             constraint saved_places_latitude_range check (latitude between -90 and 90),
  longitude  double precision not null
             constraint saved_places_longitude_range check (longitude between -180 and 180),
  created_at timestamptz      not null default now(),

  -- One per category per member: the whole of the "max 5 saved places" rule.
  constraint saved_places_one_per_category unique (user_id, category)
);

comment on table public.saved_places is
  'Named coordinates a member saves for their family. One row per (member, category), so five per member at most.';
comment on column public.saved_places.category is
  'One of home / school / work / leisure / park. The UI draws an icon per value, so the set is closed.';
comment on column public.saved_places.title is
  'What the member calls it — "Beach Park", "Dad''s office". Never geocoded.';


-- -----------------------------------------------------------------------------
-- 2. Indexes
--
-- Every read is "all the places in my family", which is what the RLS policy
-- filters on as well. The unique constraint already indexes `user_id`.
-- -----------------------------------------------------------------------------
create index if not exists saved_places_family_id_idx on public.saved_places (family_id);


-- -----------------------------------------------------------------------------
-- 3. A place cannot outlive its author's membership
--
-- `family_id` is denormalised onto the row so the RLS policies can filter
-- without a join, exactly as `locations` and `messages` do. That leaves it free
-- to disagree with the author's own family, so the insert/update path pins it:
-- a member can only file a place under the family they are actually in.
-- -----------------------------------------------------------------------------
create or replace function private.check_saved_place_family()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  member_family uuid;
begin
  select p.family_id into member_family
    from public.profiles p
   where p.id = new.user_id;

  if member_family is null or member_family is distinct from new.family_id then
    raise exception 'A place can only be saved for the family you belong to.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$fn$;

revoke all on function private.check_saved_place_family() from public;

drop trigger if exists saved_places_check_family on public.saved_places;

create trigger saved_places_check_family
  before insert or update on public.saved_places
  for each row execute function private.check_saved_place_family();


-- -----------------------------------------------------------------------------
-- 4. Row level security
--
-- Read is family-wide — a place is worth saving because everybody can see it.
-- Writes are the author's own, which is the same split `messages` uses.
--
-- Note the shape of the update policy: `using` and `with check` are both
-- required and both name `user_id`, because an UPDATE re-checks the SELECT
-- policy against the *new* row. Moving a place out of your own family would
-- move it out of your own visibility, and no `with check` can rescue that.
-- -----------------------------------------------------------------------------
alter table public.saved_places enable row level security;

drop policy if exists "saved_places: family reads" on public.saved_places;
drop policy if exists "saved_places: insert own"   on public.saved_places;
drop policy if exists "saved_places: update own"   on public.saved_places;
drop policy if exists "saved_places: delete own"   on public.saved_places;

create policy "saved_places: family reads"
  on public.saved_places for select to authenticated
  using (family_id = (select private.current_family_id()));

create policy "saved_places: insert own"
  on public.saved_places for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and family_id = (select private.current_family_id())
  );

create policy "saved_places: update own"
  on public.saved_places for update to authenticated
  using      (user_id = (select auth.uid()) and family_id = (select private.current_family_id()))
  with check (user_id = (select auth.uid()) and family_id = (select private.current_family_id()));

create policy "saved_places: delete own"
  on public.saved_places for delete to authenticated
  using (user_id = (select auth.uid()));


-- -----------------------------------------------------------------------------
-- 5. Least privilege
--
-- Supabase grants ALL on a new `public` table to `anon` and `authenticated` at
-- creation time — including TRUNCATE, which RLS does not restrain. The default
-- privileges for `anon` were already revoked in
-- `20260730120300_harden_role_privileges.sql`; `authenticated` still has to be
-- cut back to the four verbs the app uses.
-- -----------------------------------------------------------------------------
revoke all on public.saved_places from anon;
revoke all on public.saved_places from authenticated;

grant select, insert, update, delete on public.saved_places to authenticated;
