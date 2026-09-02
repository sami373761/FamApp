-- =============================================================================
-- The family calendar: birthdays, and the dates a family keeps
--
-- Two halves, and they are deliberately different kinds of thing.
--
-- `profiles.birth_date` is **identity**, not calendar. It belongs to the member
-- the way `display_name` and `color_index` do, it is written from Edit profile
-- through the same `updateOwnProfile()` those go through, and the birthday
-- countdown on Home is *derived* from it — folded out of the roster the screen
-- already holds, the way `membersAtPlaces` folds positions against places.
-- There is no birthday row and there must not be one: a stored copy would go
-- stale the moment somebody corrected their date, and it would double every
-- birthday for a member who is in the roster anyway.
--
-- `family_events` is everything a birthday is not: a date somebody typed, that
-- no other column could have supplied. An anniversary, a school holiday, the
-- day the trip starts. It carries `is_annual` because that is the one fact that
-- decides whether the date has a *next* occurrence or simply passes.
--
-- WHY THE TIER SPLITS HERE AND NOT ON BIRTHDAYS.
--
-- Birthdays stay free for every family, for the same reason knowing where the
-- family is stays free: they are a fold over rows every member can already
-- read, and folding is not a feature that can be taken away without taking the
-- rows away. What Gold sells is the *shared calendar* — the dates that only
-- exist because somebody entered them — so the ceiling is on `family_events`
-- and nowhere else.
--
-- The free ceiling is one event per family, and Gold is uncapped. That is the
-- only place in this schema where a tier is genuinely unbounded, and it is
-- worth saying why the paywall's usual rule ("no claim may be unlimited") is
-- not being broken: that rule exists because "unlimited saved places" and
-- "30-day history" were selling something no schema could deliver. Here the
-- trigger really does stop counting, so the copy and the database agree.
--
-- Like both ceilings before it, this one is **INSERT-only**. A family whose
-- grant lapses keeps every date it has entered and simply cannot add another —
-- deleting somebody's anniversary because a subscription expired is a far worse
-- outcome than a count sitting above its own ceiling until they prune it.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. A member's birth date
--
-- A plain `date`, not a timestamp: a birthday has no time of day and no zone,
-- and storing one would make the same date land on different days for two
-- members of the same family.
--
-- `private.guard_profile_columns()` is a *denylist*, so this is writable by its
-- owner without any change there — and, like `display_name`, by a family admin
-- through `profiles: admin updates members`. That is the same latitude the
-- other identity columns already give an admin, and narrowing it would be a
-- separate argument about all of them rather than about this one.
-- -----------------------------------------------------------------------------
alter table public.profiles
  add column if not exists birth_date date;

do $birth$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_birth_date_sane'
  ) then
    -- Not a validation of anybody's age — the app asks no age questions and
    -- draws no line at one. It is a bound on typos: a four-digit year slipped
    -- by one place produces a date the countdown would render as a birthday
    -- eight hundred years out, and a date in the future is not a birth date at
    -- all. `now()` is not immutable, so the upper bound is expressed as a check
    -- against a stable literal the trigger below re-states per row.
    alter table public.profiles
      add constraint profiles_birth_date_sane
      check (birth_date is null or birth_date >= date '1900-01-01');
  end if;
end;
$birth$;

comment on column public.profiles.birth_date is
  'The member''s date of birth, or NULL when they have not given one. Birthday countdowns are derived from this — there is no birthday row.';


-- -----------------------------------------------------------------------------
-- 2. A birth date cannot be in the future
--
-- The other half of the bound above, which a CHECK cannot carry because
-- `now()` is not immutable and a constraint may not call it. A trigger can, and
-- it fires on exactly the two operations that could introduce one.
-- -----------------------------------------------------------------------------
create or replace function private.check_birth_date()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if new.birth_date is not null and new.birth_date > current_date then
    raise exception 'A birth date cannot be in the future.' using errcode = 'P0001';
  end if;

  return new;
end;
$fn$;

revoke all on function private.check_birth_date() from public;

drop trigger if exists profiles_check_birth_date on public.profiles;

create trigger profiles_check_birth_date
  before insert or update of birth_date on public.profiles
  for each row execute function private.check_birth_date();


-- -----------------------------------------------------------------------------
-- 3. The shared calendar
--
-- `event_date` is a `date` for the same reason `birth_date` is: a family's
-- anniversary is a day, not an instant, and giving it a zone would move it for
-- whoever is reading from another one.
--
-- `event_type` is a closed set because the UI draws an icon per value — the
-- same argument that closes `saved_places.category`. Anything else would reach
-- a screen with no glyph and no label.
-- -----------------------------------------------------------------------------
create table if not exists public.family_events (
  id         uuid        primary key default gen_random_uuid(),
  family_id  uuid        not null references public.families (id) on delete cascade,
  title      varchar(60) not null
             constraint family_events_title_length
             check (char_length(btrim(title)) between 1 and 60),
  event_date date        not null,
  event_type text        not null
             constraint family_events_type_valid
             check (event_type in ('birthday', 'anniversary', 'holiday', 'trip', 'other')),
  created_by uuid        not null references public.profiles (id) on delete cascade,
  -- The one fact that decides whether this date recurs or simply passes. A
  -- non-annual event that is in the past is history and the client stops
  -- counting down to it; an annual one rolls to its next occurrence.
  is_annual  boolean     not null default false,
  created_at timestamptz not null default now()
);

comment on table public.family_events is
  'Dates a family enters by hand. Birthdays are NOT here — they are derived from profiles.birth_date, and stay free for every tier.';
comment on column public.family_events.is_annual is
  'Whether the date recurs each year. A one-off simply passes; an annual one rolls forward.';
comment on column public.family_events.event_type is
  'One of birthday / anniversary / holiday / trip / other. The UI draws an icon per value, so the set is closed.';

create index if not exists family_events_family_date_idx
  on public.family_events (family_id, event_date);


-- -----------------------------------------------------------------------------
-- 4. An event cannot outlive its author's membership
--
-- `family_id` is denormalised for the policies, exactly as it is on
-- `saved_places`, `locations` and `chat_polls`, so the same hole needs the same
-- trigger: a member may only file a date under the family they are actually in.
-- -----------------------------------------------------------------------------
create or replace function private.check_family_event_family()
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
   where p.id = new.created_by;

  if member_family is null or member_family is distinct from new.family_id then
    raise exception 'An event can only be saved for the family you belong to.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$fn$;

revoke all on function private.check_family_event_family() from public;

drop trigger if exists family_events_check_family on public.family_events;

create trigger family_events_check_family
  before insert or update on public.family_events
  for each row execute function private.check_family_event_family();


-- -----------------------------------------------------------------------------
-- 5. The ceiling
--
-- One shared event on the free tier, uncapped on Gold. Family-wide, not per
-- member: a per-member ceiling would leave a free family of five holding five
-- events, which is not a free tier — the same reasoning
-- `check_saved_place_limit()` uses.
--
-- INSERT-only, so a lapsed grant never deletes a date. The visible cost is the
-- same one the member cap and the place cap already pay: such a family reports
-- its count against a ceiling it is already above, until it prunes.
--
-- The exception carries a distinctive sentence because several rules on this
-- schema raise P0001 and the code alone cannot tell them apart —
-- `eventsService.toServiceError` matches the phrase, so it is not free to
-- reword on either side. The *hint* branches by tier, because selling Gold to a
-- Gold family is the same mistake as showing them the upgrade banner.
-- -----------------------------------------------------------------------------
create or replace function private.check_family_event_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_gold  boolean;
  v_count integer;
begin
  v_gold := private.is_family_premium(new.family_id);

  -- Gold is genuinely uncapped, so there is nothing left to count.
  if v_gold then
    return new;
  end if;

  select count(*) into v_count
    from public.family_events fe
   where fe.family_id = new.family_id;

  if v_count >= 1 then
    raise exception 'Family events limit reached (% of 1).', v_count
      using errcode = 'P0001',
            hint    = 'Delete an event, or upgrade the family to FamApp Gold.';
  end if;

  return new;
end;
$fn$;

revoke all on function private.check_family_event_limit() from public;

comment on function private.check_family_event_limit() is
  'Caps a free family at 1 shared event; Gold is uncapped. INSERT only — a lapsed grant never deletes anybody''s dates.';

drop trigger if exists family_events_check_limit on public.family_events;

-- After `family_events_check_family`, which is what pins `family_id` to the
-- author's actual family — the count below is only meaningful once it has.
-- Triggers of the same timing fire in name order, and "check_family" sorts
-- before "check_limit", so the order is already what it needs to be; naming
-- them this way is the whole of the dependency. It is the same trick
-- `saved_places_check_limit` relies on.
create trigger family_events_check_limit
  before insert on public.family_events
  for each row execute function private.check_family_event_limit();


-- -----------------------------------------------------------------------------
-- 6. Row level security
--
-- Read is family-wide — a shared calendar everybody cannot see is not shared.
-- Writes are the author's own, the split every other family-scoped table uses.
--
-- Both `using` and `with check` name `user`-owned columns on the UPDATE policy,
-- because an UPDATE re-checks the SELECT policy against the *new* row: moving
-- an event out of your own family would move it out of your own visibility, and
-- no `with check` can rescue that.
-- -----------------------------------------------------------------------------
alter table public.family_events enable row level security;

drop policy if exists "family_events: family reads" on public.family_events;
drop policy if exists "family_events: insert own"   on public.family_events;
drop policy if exists "family_events: update own"   on public.family_events;
drop policy if exists "family_events: delete own"   on public.family_events;

create policy "family_events: family reads"
  on public.family_events for select to authenticated
  using (family_id = (select private.current_family_id()));

create policy "family_events: insert own"
  on public.family_events for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and family_id = (select private.current_family_id())
  );

create policy "family_events: update own"
  on public.family_events for update to authenticated
  using      (created_by = (select auth.uid()) and family_id = (select private.current_family_id()))
  with check (created_by = (select auth.uid()) and family_id = (select private.current_family_id()));

create policy "family_events: delete own"
  on public.family_events for delete to authenticated
  using (created_by = (select auth.uid()));


-- -----------------------------------------------------------------------------
-- 7. Least privilege
--
-- Supabase grants ALL on a new `public` table at creation time, TRUNCATE
-- included, which RLS does not restrain.
-- -----------------------------------------------------------------------------
revoke all on public.family_events from anon;
revoke all on public.family_events from authenticated;

grant select, insert, update, delete on public.family_events to authenticated;


-- -----------------------------------------------------------------------------
-- 8. Realtime
--
-- Somebody adding the family holiday should put it on everyone's Home screen
-- without a pull-to-refresh, which is the same argument every other table in
-- the publication made. `replica identity full` is what makes the DELETE
-- deliverable: the event is published as its old row and `family_id=eq.…` is
-- matched against that, so the default identity would send a primary key the
-- channel filter has nothing to compare.
-- -----------------------------------------------------------------------------
alter table public.family_events replica identity full;

do $realtime$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'family_events'
    ) then
      alter publication supabase_realtime add table public.family_events;
    end if;
  end if;
end;
$realtime$;
