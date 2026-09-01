-- =============================================================================
-- FamApp — saved-place arrival and departure pushes
--
-- The fifth row of the Gold table finally has an event behind it. Until now
-- "saved-place arrival/departure" was tier copy and nothing else: the app
-- *folds* `locations` against `saved_places` on every render (`membersAtPlaces`
-- in `src/data/places.ts`), so it has always known who is standing where, but
-- nothing anywhere noticed the moment that answer *changed*. This migration is
-- that noticing, and it is the only place in the schema that does it.
--
-- WHY THIS NEEDS NO NEW TABLE. `locations` is one row per member, upserted, so
-- an UPDATE already carries both positions: OLD is where they were when the
-- tracker last wrote, NEW is where they are now. A geofence crossing is a pair
-- of classifications of those two rows against the same circle, which makes the
-- whole thing a fold over rows that already exist — exactly what the client
-- does, one derivative up. A `place_visits` table would be the alternative and
-- would be wrong for the reason `saved_places` already gives for not having
-- one: a stored proximity is wrong the moment somebody moves, and here it would
-- additionally have to be kept true by the very trigger reading it.
--
-- WHY 100 m, AND WHY NO HYSTERESIS BAND. The radius is `PROXIMITY_RADIUS_M`
-- from `src/data/places.ts`, and it has to be: a push saying "Sami arrived at
-- Home" while the app does not yet say "Sami at Home" is the app contradicting
-- itself on the same fact. The usual jitter defence — enter at 100 m, leave at
-- 150 m — was rejected because it is *unsound* without stored state. The only
-- record of where a member was is OLD, and OLD would have to be classified with
-- the same ambiguity: a position resting in the 100–150 m band reads as
-- "outside" on the next tick, so the departure that band exists to delay is not
-- delayed, it is lost for good. One radius, applied to both rows, is the
-- version that cannot leak an event.
--
-- WHAT ACTUALLY STOPS THE SPAM. Three things, none of them a timer:
--
--   * The tracker only writes a fix ≥ 100 m from the position it last wrote
--     (`LocationContext`), so consecutive rows are already a real movement
--     apart. GPS jitter never reaches this trigger — it never reaches the table.
--   * Only a *transition* dispatches. A stationary member's 2-hour heartbeat
--     restamps `updated_at` with the same coordinates, so OLD and NEW classify
--     identically against every place and nothing is sent. That is a property of
--     the comparison, not a special case, and the identical-coordinates check
--     below is an early exit for it rather than the rule that makes it safe.
--   * The INSERT branch dispatches nothing at all. See below.
--
-- WHY AN INSERT IS SILENT. There is no OLD on an insert, so there is no
-- transition to report — only a position, which is the thing the app already
-- shows for free. It matters more than a technicality: switching location
-- sharing off *deletes* the row (`locationService.clearOwnLocation`), so the
-- next write after switching it back on is an INSERT. Dispatching there would
-- buzz the whole family with "Sami arrived at Home" every time Sami toggled a
-- switch while sitting at home. The first row after a gap establishes a
-- baseline and says nothing; the first crossing after that is the first push.
--
-- WHY IT IS GATED ON GOLD. This is the one benefit in the premium table whose
-- boundary was already argued: knowing where the family is stays free forever,
-- because it is a fold over rows every member can read and folding cannot be
-- taken away. What Gold sells is being *told* — and now that there is something
-- to tell, the gate has to be real rather than client-side, or the row goes on
-- claiming something nothing enforces. `private.is_family_premium()` is the same
-- reader the saved-place ceiling uses, so the tier is asked the same question in
-- the same way. The in-app sentence is untouched and stays free.
--
-- WHY THE COPY IS ENGLISH. Same reason as the chat and task pushes: composed in
-- SQL, with no `Translator` in reach and no way to know the reading device's
-- language. The honest fix is a message code plus its variables rendered
-- client-side, and it needs a client that receives pushes at all.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Great-circle distance, in metres
--
-- A transcription of `getDistanceInMeters` in `src/data/geo.ts`, down to the
-- earth radius (6371008.8 m, the IUGG mean) and the clamp inside `asin` that
-- keeps a floating-point `a` marginally over 1 from returning NaN for two
-- antipodal points. The two must stay in step for the same reason
-- `is_family_premium` and `isPremiumActive` must: this decides when a push is
-- sent and that one decides what the screen says about it, and a family should
-- never be able to catch the two disagreeing.
--
-- PostGIS would be the other way to do this and is not installed; a spherical
-- earth is off by ~0.5% at worst, which against a 100 m radius is well inside
-- the error of the fix being measured.
-- -----------------------------------------------------------------------------
create or replace function private.geo_distance_meters(
  p_lat_a double precision,
  p_lon_a double precision,
  p_lat_b double precision,
  p_lon_b double precision
)
returns double precision
language sql
immutable
parallel safe
set search_path = ''
as $fn$
  select 2 * 6371008.8 * asin(least(1, sqrt(
      sin(radians(p_lat_b - p_lat_a) / 2) ^ 2
    + cos(radians(p_lat_a)) * cos(radians(p_lat_b))
    * sin(radians(p_lon_b - p_lon_a) / 2) ^ 2
  )));
$fn$;

revoke all on function
  private.geo_distance_meters(double precision, double precision, double precision, double precision)
from public, anon, authenticated;

comment on function private.geo_distance_meters(double precision, double precision, double precision, double precision) is
  'Haversine distance in metres. The SQL half of getDistanceInMeters() in src/data/geo.ts — keep the two in step.';


-- -----------------------------------------------------------------------------
-- 2. What a place is called in a broadcast
--
-- Mirrors `placeSentence()` as far as a single body can. `leisure` and `park`
-- belong to nobody, so "Beach Park" is the whole name; a `home`/`school`/`work`
-- saved by somebody else is named with its owner, because "Left Home" broadcast
-- to a family is ambiguous about whose home the moment two members have saved
-- one.
--
-- The third client form has no analogue here and cannot have one: `places.
-- atYours` ("your Home") is rendered per *reader*, and one push carries one
-- body to every device in the family. A place is therefore named from the point
-- of view of the member who moved — which is also the only point of view the
-- notification is describing.
-- -----------------------------------------------------------------------------
create or replace function private.push_place_label(
  p_place_id uuid,
  p_mover_id uuid
)
returns text
language sql
stable
security definer
set search_path = ''
as $fn$
  select case
           when sp.category in ('leisure', 'park') or sp.user_id = p_mover_id
             then btrim(sp.title)
           else private.push_display_name(sp.user_id) || '''s ' || btrim(sp.title)
         end
    from public.saved_places sp
   where sp.id = p_place_id;
$fn$;

revoke all on function private.push_place_label(uuid, uuid) from public, anon, authenticated;

comment on function private.push_place_label(uuid, uuid) is
  'How a saved place is named in a family-wide push: bare title for public categories and for the mover''s own places, owner-possessive otherwise.';


-- -----------------------------------------------------------------------------
-- 3. The geofence trigger
--
-- One pass over the family's places per stored position, classifying OLD and
-- NEW against each. Both directions can fire in one update and legitimately do:
-- 100 m of movement is enough to leave one place and reach another when the two
-- are close, and both crossings are true.
--
-- One divergence from the client is worth naming rather than hiding.
-- `nearestPlace` picks the *closest* place within the radius, so where two
-- circles overlap the app names one place at a time; this trigger is per-place,
-- so a member drifting from one overlapping circle to another stays inside both
-- and produces no event even though the in-app sentence changes. Enter/exit per
-- fence is the geofence semantic; "which place are they at" is a different
-- question, and the client is the one that answers it.
-- -----------------------------------------------------------------------------
create or replace function private.notify_on_geofence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  -- PROXIMITY_RADIUS_M in src/data/places.ts. See the header: one radius, no
  -- hysteresis band, because a band cannot be classified from OLD alone.
  c_radius constant double precision := 100;

  v_mover  text;
  v_label  text;
  v_place  record;
begin
  -- No previous position means no transition. An INSERT is the first fix of a
  -- new member *or* the first after sharing was switched off and on again, and
  -- neither is somebody arriving anywhere.
  if tg_op = 'INSERT' then
    return null;
  end if;

  -- Changing families makes OLD's distances meaningless: they were measured
  -- against circles this row's new family cannot even see. Treat it as a
  -- baseline, exactly like an insert.
  if old.family_id is distinct from new.family_id then
    return null;
  end if;

  -- The stationary heartbeat: `locations_touch_updated_at` restamps
  -- `updated_at` every write, so a fix that did not move still arrives here as
  -- an UPDATE. The classification below would already find no transition; this
  -- just declines to scan the places to discover that.
  if old.latitude = new.latitude and old.longitude = new.longitude then
    return null;
  end if;

  -- Gold sells the notification, not the fact. A free family still sees "Sami
  -- at Home" in the app; nobody's device buzzes about it.
  if not private.is_family_premium(new.family_id) then
    return null;
  end if;

  v_mover := private.push_display_name(new.user_id);

  for v_place in
    select sp.id,
           private.geo_distance_meters(old.latitude, old.longitude, sp.latitude, sp.longitude) as was,
           private.geo_distance_meters(new.latitude, new.longitude, sp.latitude, sp.longitude) as now_
      from public.saved_places sp
     where sp.family_id = new.family_id
  loop
    if v_place.was > c_radius and v_place.now_ <= c_radius then
      v_label := private.push_place_label(v_place.id, new.user_id);

      perform private.dispatch_push(
        new.family_id,
        -- The mover is the sender, which is what makes send-push exclude them:
        -- being told you arrived where you are standing is the one recipient
        -- this event never has.
        new.user_id,
        null,
        v_mover,
        'Arrived at ' || v_label,
        jsonb_build_object(
          'type', 'place_arrival',
          'family_id', new.family_id,
          'user_id', new.user_id,
          'place_id', v_place.id
        )
      );

    elsif v_place.was <= c_radius and v_place.now_ > c_radius then
      v_label := private.push_place_label(v_place.id, new.user_id);

      perform private.dispatch_push(
        new.family_id,
        new.user_id,
        null,
        v_mover,
        'Left ' || v_label,
        jsonb_build_object(
          'type', 'place_departure',
          'family_id', new.family_id,
          'user_id', new.user_id,
          'place_id', v_place.id
        )
      );
    end if;
  end loop;

  return null;
exception
  when others then
    -- The position is written and the map is already right. A notification is a
    -- side effect and must never be able to reject the row that caused it —
    -- the same subtransaction guard the chat and task triggers carry.
    raise warning 'notify_on_geofence failed for member %: %', new.user_id, sqlerrm;
    return null;
end;
$fn$;

revoke all on function private.notify_on_geofence() from public, anon, authenticated;

drop trigger if exists locations_notify_geofence on public.locations;
create trigger locations_notify_geofence
  after insert or update on public.locations
  for each row execute function private.notify_on_geofence();

comment on function private.notify_on_geofence() is
  'Dispatches a push when a member crosses the 100 m radius of one of their family''s saved places. Gold only, silent on insert, and a no-op for a position that did not move.';
