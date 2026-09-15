-- =============================================================================
-- Three client-side rules become server-side ones
--
-- FamApp has carried three deliberate "the UI stops you, the database does not"
-- boundaries, each written down as such in CLAUDE.md:
--
--   * `canActOnTask()` kept members out of each other's assigned tasks, while
--     `tasks: family updates` let any member update any task in the family.
--   * The chat "+" menu padlocked photo sending on a free family, while
--     `messages: send as self` accepted an `image` row from anyone.
--   * `profiles.push_token` was readable by the whole family, because
--     `profiles: read own and family` is family-wide and the grants on
--     `profiles` were table-level.
--
-- Each was honest while nothing depended on it. The first two are now enforced
-- where the decision belongs, and the third is closed before the sender that
-- started spending it (20260829100000) has a real token to spend.
--
-- WHAT THIS DOES NOT DO: it does not narrow `tasks: family updates` or
-- `messages: send as self`. A policy is a row filter, and both rules are about
-- *which columns changed* and *what the family's tier is* — an UPDATE policy
-- cannot see OLD and NEW together, and neither can be expressed as a `using`
-- clause without also blocking the reads and edits that must keep working
-- (`linkTaskToMessage` updates a task the caller may not be assigned to).
-- Triggers are what can see the transition; the policies stay as they are and
-- the triggers are the narrower gate inside them.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. A task assigned to somebody is theirs to move
--
-- `canActOnTask()` in src/components/tasks/task-status-actions.tsx is the
-- client half and the two must agree: an unassigned task is the pool and anyone
-- in the family may take it, a task naming somebody belongs to them. The server
-- adds the two people the UI has no reason to distinguish — a family admin and
-- the family's creator — because moderation has to be possible from somewhere.
--
-- FIVE THINGS ARE DELIBERATE:
--
--  * **It gates the transition, not the row.** Only a change to `status` or to
--    `assigned_to` is refused. Everything else a task carries stays family-wide
--    exactly as before, which is what keeps `linkTaskToMessage()` working: the
--    creator of a task assigned to somebody else still writes
--    `source_message_id` onto it a moment after the insert.
--
--  * **`assigned_to` is guarded alongside `status`,** and without that the
--    status guard is decorative: a non-assignee who could reassign a task to
--    themselves in one PostgREST call would then be the assignee, and free to
--    complete it in the next.
--
--  * **It is SECURITY INVOKER, like `guard_profile_columns()`.** The exemption
--    below reads `current_user`, which a SECURITY DEFINER body would report as
--    the function's owner for every caller — the check would then pass for
--    everyone and the guard would be a no-op. Being invoker is also what lets
--    `cleanup_expired_tasks()` (SECURITY DEFINER, owned by `postgres`) sweep a
--    task to `expired` on behalf of nobody.
--
--  * **`handled_by` may only ever name the caller.** The column means "last
--    member who moved the task between states", so a row claiming somebody else
--    did it is a false record rather than a permission question. Clearing it is
--    left alone: `assigned_to`/`handled_by` are `on delete set null`, and an
--    account deletion must not be blocked by a task it once touched.
--
--  * **The message carries the word "task" on purpose.** `taskService`'s
--    `toServiceError()` keys its P0001 branches on the sentence, the same way
--    `familyService` matches `/full/i`. Both sentences here are matched by
--    `/assigned|moved/i` — tested *before* the 20-active-task branch, which
--    keys on the broader `/task/i` — and pass through to the user as the
--    server's own text.
-- -----------------------------------------------------------------------------
create or replace function private.guard_task_assignment()
returns trigger
language plpgsql
set search_path = ''
as $fn$
declare
  v_actor uuid := (select auth.uid());
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role')
     or v_actor is null
  then
    return new;
  end if;

  if new.handled_by is distinct from old.handled_by
     and new.handled_by is not null
     and new.handled_by <> v_actor
  then
    raise exception 'A task is recorded as moved by whoever moved it.'
      using errcode = 'P0001';
  end if;

  -- The pool: no owner, so nothing to protect.
  if old.assigned_to is null then
    return new;
  end if;

  if old.assigned_to = v_actor
     or (private.is_family_admin() and old.family_id = private.current_family_id())
     or exists (
          select 1
            from public.families f
           where f.id = old.family_id
             and f.created_by = v_actor
        )
  then
    return new;
  end if;

  if new.status is distinct from old.status
     or new.assigned_to is distinct from old.assigned_to
  then
    raise exception 'This task is assigned to another member.'
      using errcode = 'P0001',
            hint    = 'Ask them to hand it over, or ask a family admin.';
  end if;

  return new;
end;
$fn$;

comment on function private.guard_task_assignment() is
  'A task naming an assignee may only be moved (status) or reassigned (assigned_to) by that member, a family admin, or the family creator. The server half of canActOnTask().';

revoke all on function private.guard_task_assignment() from public;

drop trigger if exists tasks_guard_assignment on public.tasks;

-- After `tasks_enforce_active_limit`, which is BEFORE INSERT OR UPDATE OF
-- status and sorts first by name. Either order is correct — the two rules are
-- independent — and naming it this way keeps the ceiling's message the one a
-- full family sees.
create trigger tasks_guard_assignment
  before update on public.tasks
  for each row execute function private.guard_task_assignment();

comment on policy "tasks: family updates" on public.tasks is
  'Family-wide by row. Which *columns* a non-assignee may change is narrowed by private.guard_task_assignment().';


-- -----------------------------------------------------------------------------
-- 2. A photo in the family chat is a Gold benefit
--
-- `ChatActionsList` padlocks the row and pushes the paywall; this is what
-- happens when the padlock is walked around. It is the same shape as
-- `check_saved_place_limit()` — the tier read is `private.is_family_premium()`
-- so that the SQL and `isPremiumActive()` in src/data/premium.ts stay one rule
-- with two spellings.
--
-- THREE THINGS ARE DELIBERATE:
--
--  * **INSERT only.** A family whose grant lapses keeps the photos it sent, for
--    exactly the reason the saved-place ceiling is INSERT-only: taking somebody's
--    data away when they stop paying is a worse outcome than a table sitting
--    above a ceiling it can no longer reach. The 10-day sweep collects them in
--    its own time.
--
--  * **The object is not its own business.** `chat-media: upload to own path`
--    is left alone, so a free family could still put bytes in the bucket — and
--    then have nothing to point at them, because this rejects the row. Uploading
--    is not sharing; the message is what the family can see, so the message is
--    what is gated. An orphaned object is what `cleanup-media` already exists to
--    collect.
--
--  * **SECURITY DEFINER, and therefore no `current_user` test.**
--    `private.is_family_premium()` is granted to nobody, which is what a
--    definer body gets past; the `auth.uid() is null` bypass covers the
--    service_role and cron contexts that have no JWT. Nothing server-side
--    inserts an `image` row today, so there is no second caller to exempt.
-- -----------------------------------------------------------------------------
create or replace function private.enforce_media_message_tier()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
begin
  if (select auth.uid()) is null then
    return new;
  end if;

  if new.message_type = 'image'
     and not private.is_family_premium(new.family_id)
  then
    raise exception 'Sharing photos in the family chat needs FamApp Gold.'
      using errcode = 'P0001',
            hint    = 'Upgrade the family to FamApp Gold to send photos.';
  end if;

  return new;
end;
$fn$;

comment on function private.enforce_media_message_tier() is
  'Rejects an `image` message from a family without an unexpired Gold grant. The server half of the chat photo padlock.';

revoke all on function private.enforce_media_message_tier() from public;

drop trigger if exists messages_enforce_media_tier on public.messages;

-- BEFORE INSERT, so a refused photo never reaches
-- `messages_bump_photo_count` (AFTER INSERT) and cannot spend a day's count on
-- a message that was not sent.
create trigger messages_enforce_media_tier
  before insert on public.messages
  for each row execute function private.enforce_media_message_tier();

comment on policy "messages: send as self" on public.messages is
  'Pins sender_id and family_id. Whether an `image` row is allowed at all is private.enforce_media_message_tier().';


-- -----------------------------------------------------------------------------
-- 3. A push token is nobody else's to read
--
-- 20260825120000 wrote this exposure down and left it open, naming the two ways
-- to close it and the condition for doing so: "do one of them before anything
-- actually sends a push." 20260829100000 is that sender. This is the first of
-- the two options — column privileges — rather than a `push_tokens` table,
-- because the sender, the three notification triggers and the DeviceNotRegistered
-- cleanup in `send-push` all already read `profiles.push_token`, and moving the
-- column would rewrite all four to close a hole that a grant closes.
--
-- **The revoke has to come first.** A column-level REVOKE cannot subtract from a
-- table-level grant — Postgres stores those as separate ACL entries and the sum
-- is what counts, so `revoke select (push_token)` against the table-level SELECT
-- granted in 20260730120300 would warn and change nothing. Dropping the
-- table-level privilege and re-granting per column is the only way to express
-- "every column except this one".
--
-- **THE COST, STATED PLAINLY: `select *` on `profiles` now fails for
-- `authenticated`,** because the expansion includes a column the role cannot
-- read. The three call sites that did this are changed in the same commit
-- (`AuthContext.fetchProfile`, `familyService.readFamily`,
-- `familyService.updateOwnProfile`) and `PROFILE_COLUMNS` in familyService is
-- the one list they share. **A future migration that adds a column to
-- `profiles` must add it to the grant below and to that constant**, or it will
-- be invisible to the app rather than merely unused.
--
-- `service_role` is untouched and keeps full SELECT, which is what `send-push`
-- runs as. `anon` was revoked outright in 20260730120300 and is not re-granted
-- here.
-- -----------------------------------------------------------------------------
revoke select on public.profiles from authenticated;

grant select (
  id,
  family_id,
  display_name,
  role,
  avatar_config,
  color_index,
  is_admin,
  daily_photo_count,
  birth_date,
  created_at
) on public.profiles to authenticated;

comment on column public.profiles.push_token is
  'Expo push token for the device this member last enabled notifications on, or NULL when they have none. Readable only by its owner (public.own_push_token()) and by service_role; writable only by the owner (private.guard_profile_columns()).';


-- The owner's own read, which the revoke above took away along with everybody
-- else's. Nothing in the app calls it today — `notificationService` writes the
-- token and deliberately does not read it back — but "only you can read it" and
-- "nobody can read it" are different rules, and this is the one that was
-- asked for. SECURITY DEFINER because the column privilege is gone for
-- `authenticated` whichever row is being read; `auth.uid()` is what narrows it
-- back to one row.
create or replace function public.own_push_token()
returns text
language sql
stable
security definer
set search_path = ''
as $fn$
  select p.push_token
    from public.profiles p
   where p.id = (select auth.uid());
$fn$;

comment on function public.own_push_token() is
  'The calling account''s own Expo push token, or NULL. The only read path left for a column no member can select.';

revoke all on function public.own_push_token() from public, anon;
grant execute on function public.own_push_token() to authenticated, service_role;
