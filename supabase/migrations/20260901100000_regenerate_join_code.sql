-- =============================================================================
-- FamApp — rotating a family's join code
--
-- A join code is a shared secret that gets read aloud, screenshotted and pasted
-- into group chats, so an admin needs a way to burn one. `public.regenerate_
-- join_code()` is that way, and it is an RPC for three separate reasons, any one
-- of which would be enough on its own:
--
--   1. `private.guard_family_columns()` (20260825140000) rejects every direct
--      write to `join_code` — "A join code cannot be changed" — because letting
--      a client pick one would let it collide with another family's. This
--      function runs SECURITY DEFINER, so `current_user` is the migration's
--      owner and the guard's first clause waves it through, exactly as
--      `set_family_premium()` already relies on. That guard is not being
--      relaxed: a client still cannot choose a code, it can only ask for a new
--      one to be generated.
--   2. Uniqueness is settled by the unique index inside a retry loop, the same
--      loop `create_family()` uses. There is no way to express that as a single
--      client-side UPDATE.
--   3. The `families: creator updates` policy is scoped to `created_by`, so an
--      admin who did not create the family could not update the row at all.
--      Admin, not creator, is the boundary this feature wants.
--
-- Members already in the family are unaffected — `profiles.family_id` is what
-- membership is, and the code is only ever read by `join_family()`.
-- =============================================================================


create or replace function public.regenerate_join_code()
returns varchar(6)
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_uid     uuid := (select auth.uid());
  v_family  uuid;
  v_code    varchar(6);
  v_attempt integer := 0;
begin
  if v_uid is null then
    raise exception 'Not authenticated.' using errcode = '28000';
  end if;

  v_family := private.current_family_id();

  -- One sentence for both halves on purpose. A profile can legitimately carry
  -- `is_admin` with a NULL `family_id` — `guard_profile_columns()` lets a member
  -- clear their own family_id and says nothing about is_admin — and "admin of no
  -- family" is not an admin of anything. `familyService` matches this text on
  -- 42501 and reports it as NOT_ADMIN.
  if v_family is null or not private.is_family_admin() then
    raise exception 'Only a family admin can change the join code.' using errcode = '42501';
  end if;

  -- `create_family()`'s loop, for the same reason: the alphabet is 32 glyphs
  -- over 6 places, so a collision is rare enough to retry blindly and likely
  -- enough to be worth catching at all.
  loop
    v_attempt := v_attempt + 1;

    begin
      update public.families
         set join_code = private.random_join_code()
       where id = v_family
      returning join_code into v_code;

      exit;
    exception when unique_violation then
      if v_attempt >= 10 then
        raise exception 'Could not allocate a unique join code.' using errcode = 'P0001';
      end if;
    end;
  end loop;

  return v_code;
end;
$fn$;

comment on function public.regenerate_join_code() is
  'Admin-only: replaces the caller''s family join code with a freshly generated one and returns it. The old code stops working immediately.';


revoke all     on function public.regenerate_join_code() from public, anon;
grant  execute on function public.regenerate_join_code() to authenticated;
