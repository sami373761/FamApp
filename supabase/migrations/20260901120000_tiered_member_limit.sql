-- =============================================================================
-- FamApp — the member cap becomes the family's cap, not one number for everyone
--
-- `private.enforce_family_member_limit()` has always read `families.max_members`,
-- which is `not null default 10` with a `between 1 and 10` check — so in
-- practice every family was capped at 10 whatever they paid. The paywall has
-- said "A free family holds 5. Gold makes room for 10." since
-- 20260825140000, and until now that line was copy: the trigger admitted a
-- sixth member to a free family without complaint.
--
-- This is the second ceiling Gold actually moves (saved places was the first,
-- `private.check_saved_place_limit()`), and it is split the same way and in the
-- same place — in the database, because that is where this app's other business
-- rules live and a client-side ceiling is a suggestion.
--
-- Three things are deliberate:
--
--  * **`least(max_members, tier)`**, not the tier alone. `max_members` is the
--    schema's own hard ceiling and its check constraint is what guarantees no
--    family ever exceeds 10 however the tier is computed; the tier narrows that
--    bound, it does not replace it. A row carrying a smaller `max_members`
--    keeps it.
--
--  * **The premium read happens after the `for update`.** The lock on the
--    families row is what stops two people redeeming the same join code from
--    both slipping past the count, and it now also pins the pair of columns the
--    tier is folded from — `private.is_family_premium()` reads the row this
--    transaction has already locked, so the cap cannot change underneath the
--    count. It is that function rather than an inline `is_premium and …`
--    because the tier is two columns and every server-side reader has to fold
--    them the same way.
--
--  * **Nobody is ejected when a grant lapses.** This fires on INSERT and on an
--    UPDATE that *changes* `family_id` — joining, in other words — so a family
--    of eight whose Gold runs out keeps all eight and simply cannot admit a
--    ninth. That is the same choice the saved-place ceiling makes by being
--    INSERT-only, for the same reason: deleting somebody's membership because a
--    subscription expired is a far worse outcome than a count sitting above its
--    own ceiling until the family prunes it. The visible consequence is that
--    such a family reports "This family is full (10 of 5 members)" on the next
--    join attempt — awkward but true, and the same shape the saved-place
--    ceiling already produces for the same reason.
--
-- The exception sentence is unchanged on purpose. `familyService.toServiceError`
-- matches `/full/i` on P0001 to produce `FAMILY_FULL`, and the server's text is
-- passed through to the user as-is, so the phrase is not free to reword. The
-- *hint* is what carries the new half, and it branches the way the saved-place
-- one does: a family already on Gold is at the real ceiling, and telling them to
-- upgrade would be selling them what they have.
-- =============================================================================

create or replace function private.enforce_family_member_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_hard  integer;
  v_gold  boolean;
  v_max   integer;
  v_count integer;
begin
  if new.family_id is null then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.family_id is not distinct from new.family_id then
    return new;
  end if;

  select f.max_members into v_hard
    from public.families f
   where f.id = new.family_id
     for update;

  if v_hard is null then
    raise exception 'Family % does not exist', new.family_id using errcode = '23503';
  end if;

  v_gold := private.is_family_premium(new.family_id);
  v_max  := least(v_hard, case when v_gold then 10 else 5 end);

  select count(*) into v_count
    from public.profiles p
   where p.family_id = new.family_id
     and p.id <> new.id;

  if v_count >= v_max then
    raise exception 'This family is full (% of % members).', v_count, v_max
      using errcode = 'P0001',
            hint    = case when v_gold
                           then 'Ask an admin to remove a member first.'
                           else 'Ask an admin to remove a member, or upgrade the family to FamApp Gold.'
                      end;
  end if;

  return new;
end;
$fn$;

comment on function private.enforce_family_member_limit() is
  'Caps a family at 5 members on the free tier and 10 on Gold, never above families.max_members. Fires on joining only — a lapsed grant never removes anyone.';

comment on column public.families.max_members is
  'The schema''s hard ceiling: never above 10. The tier narrows it further — 5 free, 10 on Gold — in private.enforce_family_member_limit().';
