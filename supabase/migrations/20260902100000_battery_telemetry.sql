-- =============================================================================
-- Battery telemetry on the position row
--
-- `locations` has always been "where somebody is, and when that was written".
-- This adds the one other fact a device knows about itself at the moment it
-- takes a fix: how much charge it has left, and whether it is plugged in. It is
-- worth having for the same reason the timestamp is — "Sami is at the park" and
-- "Sami's phone is on 4%" are the two halves of why a pin might stop moving.
--
-- FOUR THINGS ARE DELIBERATE:
--
--  * **Two columns on `locations`, not a table of their own.** A battery
--    reading has exactly the lifetime of a position: it is taken in the same
--    tick, it is overwritten by the next one, and it is meaningless once the
--    row is deleted. A second table would have to be swept, joined and kept in
--    step with something that is already one row per member.
--
--  * **Both are nullable, and NULL is the answer, not a gap.** NULL means "this
--    device is not sharing its battery" — the privacy switch is device-local
--    (`batterySharing` in `PreferencesContext`), so there is no column that
--    could record the *intent*, only the absence of the reading. It is also
--    what a device with no battery API (the web target) writes, and what every
--    row written before this migration already holds.
--
--  * **The client writes NULL rather than skipping the columns.** `locations`
--    is upserted, so an update that omitted them would leave yesterday's charge
--    beside today's position. Switching the privacy toggle off therefore clears
--    what is stored (`locationService.clearOwnBattery()`) instead of waiting
--    twelve minutes for a fix that may never come.
--
--  * **Nothing here decides when a reading is shown.** The client renders the
--    badge only for a member whose position is inside `ONLINE_WINDOW_MS`, which
--    is a statement about freshness and belongs where presence is derived. A
--    battery percentage attached to an hours-old row is a number that reads as
--    current and is not, which is the one failure this feature can have.
--
-- No RLS change: the columns ride the row, and `locations: family reads` /
-- `locations: update own` already say who may see and write it. Realtime needs
-- nothing either — `locations` is already in the publication and already
-- carries `replica identity full` (20260901110000), so an UPDATE that changes
-- only the charge is delivered like any other.
-- =============================================================================

alter table public.locations
  add column if not exists battery_level smallint;

alter table public.locations
  add column if not exists battery_charging boolean;

-- A percentage, so the range is the constraint. `expo-battery` reports a
-- fraction and an "unknown" of -1; the client converts and drops the latter to
-- NULL rather than storing a sentinel the check would have to make room for.
do $battery$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'locations_battery_level_range'
  ) then
    alter table public.locations
      add constraint locations_battery_level_range
      check (battery_level is null or battery_level between 0 and 100);
  end if;
end;
$battery$;

comment on column public.locations.battery_level is
  'Charge percentage 0-100 at the moment this position was written, or NULL when the device is not sharing it. Shown only while the row is fresh enough to read as live.';
comment on column public.locations.battery_charging is
  'Whether the device was plugged in when this position was written, or NULL when it is not sharing its battery.';
