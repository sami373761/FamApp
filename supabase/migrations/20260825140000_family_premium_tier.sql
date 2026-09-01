-- =============================================================================
-- FamApp Gold — the family's subscription tier
--
-- The paywall has been a mock since it was written: two prices in a TSX file, a
-- CTA that confirms and closes. This migration gives it a row to write, which
-- is the first half of making Gold real. It is deliberately *only* the first
-- half — there is still no store, no receipt and no webhook, so nothing here
-- verifies that anybody paid. What it does provide is the one place the answer
-- lives, guarded so the client cannot simply flip it.
--
-- The tier belongs to the **family**, not to the member. Every benefit on the
-- paywall is a family-wide ceiling (members per family, tasks, places, photos
-- in the shared chat), and one subscription covering everybody is exactly what
-- the footnote already promises. A per-profile column would have to be folded
-- back into a family answer on every read, and would disagree with itself the
-- moment two members held different values.
--
-- TWO COLUMNS, AND WHY BOTH:
--   * `is_premium`    — whether the family was ever granted Gold.
--   * `premium_until` — when that grant runs out. NULL means "no end recorded".
--
-- Neither on its own is the answer. `is_premium` alone cannot expire, and an
-- expiry alone cannot say "granted, no end date" — so *active* is the pair,
-- read the same way on both sides: `is_premium and (premium_until is null or
-- premium_until > now())`. `private.is_family_premium()` below is the SQL half
-- and `isPremiumActive()` in `src/data/premium.ts` is the client half; they must
-- stay in step, which is why neither is duplicated anywhere else.
--
-- WRITES ARE RPC-ONLY, like membership. `families: creator updates` already
-- lets the family's creator update their own row, so without a guard the
-- paywall could be skipped with one PostgREST call from the publishable key.
-- `private.guard_family_columns()` rejects a direct write to either column, and
-- `public.set_family_premium()` — SECURITY DEFINER, and therefore running as
-- the migration's owner, which the guard lets through — is the only way in.
-- When a real store is wired up, that function is where receipt verification
-- goes, and the client stops being able to call it at all.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Columns
--
-- `is_premium` is `not null default false` because "not subscribed" is the
-- normal state and every existing family is in it. `premium_until` is nullable
-- for the opposite reason: an end date is a fact some grants have and others
-- (a comp, a lifetime plan) do not, and storing a far-future timestamp to
-- stand in for "never" would be inventing one.
-- -----------------------------------------------------------------------------
alter table public.families
  add column if not exists is_premium boolean not null default false;

alter table public.families
  add column if not exists premium_until timestamptz;

comment on column public.families.is_premium is
  'Whether this family has been granted FamApp Gold. Not the whole answer on its own — see premium_until and private.is_family_premium().';
comment on column public.families.premium_until is
  'When the Gold grant lapses, or NULL when no end date was recorded. A past timestamp means expired.';


-- -----------------------------------------------------------------------------
-- 2. Is this family actually on Gold?
--
-- Defined after the columns it selects, because a SQL-language body is
-- validated at creation time. `stable` rather than `immutable`: it reads a
-- table and calls now().
--
-- The whole point of having it is that "premium" is a pair of columns and not
-- one, so every server-side reader — today the saved-place ceiling, tomorrow
-- whatever else Gold widens — asks the same question the same way.
-- -----------------------------------------------------------------------------
create or replace function private.is_family_premium(p_family_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $fn$
  select coalesce(
    (select f.is_premium and (f.premium_until is null or f.premium_until > now())
       from public.families f
      where f.id = p_family_id),
    false
  );
$fn$;

revoke all on function private.is_family_premium(uuid) from public;

comment on function private.is_family_premium(uuid) is
  'True when the family holds an unexpired Gold grant. The SQL half of the rule; isPremiumActive() in src/data/premium.ts is the client half.';


-- -----------------------------------------------------------------------------
-- 3. Neither column is writable by a client
--
-- `guard_profile_columns()` does this job for `profiles`; this is the same
-- denylist for `families`, and the same escape hatch — a SECURITY DEFINER
-- function runs as its owner, so `current_user` is no longer the caller's role
-- and the RPC below passes straight through.
--
-- `families` has exactly one other writable column in practice (`name`, via
-- "families: creator updates"), so this guard costs nothing that was in use.
-- -----------------------------------------------------------------------------
create or replace function private.guard_family_columns()
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

  if new.is_premium is distinct from old.is_premium
     or new.premium_until is distinct from old.premium_until
  then
    raise exception 'Subscription status is managed by the server.' using errcode = '42501';
  end if;

  -- The join code is generated inside create_family()'s uniqueness retry loop.
  -- Letting the creator rewrite it would let them collide with another family's
  -- code, which the loop exists to prevent.
  if new.join_code is distinct from old.join_code then
    raise exception 'A join code cannot be changed.' using errcode = '42501';
  end if;

  if new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at
  then
    raise exception 'created_by and created_at are immutable.' using errcode = '42501';
  end if;

  return new;
end;
$fn$;

revoke all on function private.guard_family_columns() from public;

drop trigger if exists families_guard_columns on public.families;

create trigger families_guard_columns
  before update on public.families
  for each row execute function private.guard_family_columns();


-- -----------------------------------------------------------------------------
-- 4. Granting Gold
--
-- SECURITY DEFINER for two reasons: the guard above, and the fact that the
-- caller need not be the family's creator — any member may subscribe, which is
-- what "one subscription covers all family members" means from the other side.
--
-- `p_plan` decides the window, and the two answers mirror the paywall's copy
-- exactly:
--   * 'annual'  — a 7-day free trial, which is what the CTA says it is
--                 starting. The full year is not granted here: nothing has been
--                 charged, and writing a year would be recording a payment that
--                 did not happen.
--   * 'monthly' — one month, the period the plan bills for.
--
-- An existing unexpired grant is *extended* rather than replaced, so somebody
-- who subscribes twice does not lose the time they already had.
-- -----------------------------------------------------------------------------
create or replace function public.set_family_premium(p_plan text)
returns public.families
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid    uuid := (select auth.uid());
  v_family uuid;
  v_window interval;
  v_from   timestamptz;
  v_row    public.families;
begin
  if v_uid is null then
    raise exception 'Not authenticated.' using errcode = '28000';
  end if;

  v_window := case p_plan
                when 'annual'  then interval '7 days'
                when 'monthly' then interval '1 month'
              end;

  if v_window is null then
    raise exception 'Unknown plan %.', p_plan using errcode = 'P0001';
  end if;

  select p.family_id into v_family from public.profiles p where p.id = v_uid;

  if v_family is null then
    raise exception 'You need a family before you can subscribe.' using errcode = 'P0001';
  end if;

  -- Extending from the later of "now" and the current expiry is what stops a
  -- second purchase during a live grant from shortening it.
  select greatest(now(), coalesce(f.premium_until, now()))
    into v_from
    from public.families f
   where f.id = v_family;

  update public.families
     set is_premium    = true,
         premium_until = v_from + v_window
   where id = v_family
  returning * into v_row;

  return v_row;
end;
$fn$;

revoke all     on function public.set_family_premium(text) from public, anon;
grant  execute on function public.set_family_premium(text) to authenticated;

comment on function public.set_family_premium(text) is
  'Grants FamApp Gold to the caller''s family for the plan''s window. NOTHING IS VERIFIED — there is no store behind this yet; receipt validation belongs here.';


-- -----------------------------------------------------------------------------
-- 5. The first ceiling Gold actually moves
--
-- Every other benefit on the paywall is still copy: the member trigger caps all
-- families at 10, the task trigger counts 20 per family, chat photos are
-- unbuilt and nothing sends a push. Saved places are the one that can be split
-- today without touching a feature that does not exist, so it is the one split
-- here — and it is split *in the database*, because that is where this app's
-- other business rules live and a client-side ceiling is a suggestion.
--
-- Family-wide, not per member. `unique (user_id, category)` already caps each
-- member at five; a tier ceiling that only counted your own rows would leave a
-- free family of four with twenty places, which is not a free tier.
--
-- The trigger is INSERT-only on purpose. A family whose grant lapses keeps the
-- places it saved — deleting somebody's data when they stop paying is a far
-- worse outcome than letting the count sit above the free ceiling until they
-- prune it, and an UPDATE check would also block them from renaming a row they
-- can already see.
-- -----------------------------------------------------------------------------
create or replace function private.check_saved_place_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_gold  boolean;
  v_limit integer;
  v_count integer;
begin
  v_gold  := private.is_family_premium(new.family_id);
  v_limit := case when v_gold then 10 else 2 end;

  select count(*) into v_count
    from public.saved_places sp
   where sp.family_id = new.family_id;

  if v_count >= v_limit then
    -- P0001 with a distinctive sentence, which is how every other rule in this
    -- schema reports itself: several failures share the code, so `placesService`
    -- matches the message as well (see `toServiceError`). The phrase is what it
    -- keys on, so it is not free to reword.
    raise exception 'Saved places limit reached (% of %).', v_count, v_limit
      using errcode = 'P0001',
            -- A family already on Gold is at the real ceiling; telling them to
            -- upgrade would be selling them what they have.
            hint    = case when v_gold
                           then 'Delete a saved place to make room.'
                           else 'Delete a saved place, or upgrade the family to FamApp Gold.'
                      end;
  end if;

  return new;
end;
$fn$;

revoke all on function private.check_saved_place_limit() from public;

comment on function private.check_saved_place_limit() is
  'Caps a family at 2 saved places on the free tier and 10 on Gold. INSERT only — a lapsed grant never deletes rows.';

drop trigger if exists saved_places_check_limit on public.saved_places;

-- After `saved_places_check_family`, which is what pins `family_id` to the
-- author's actual family — the count below is only meaningful once it has.
-- Triggers of the same timing fire in name order, and "check_family" sorts
-- before "check_limit", so the order is already what it needs to be; naming it
-- this way is the whole of the dependency.
create trigger saved_places_check_limit
  before insert on public.saved_places
  for each row execute function private.check_saved_place_limit();
