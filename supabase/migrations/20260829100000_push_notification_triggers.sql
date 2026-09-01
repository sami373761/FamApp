-- =============================================================================
-- FamApp — push notification dispatch
--
-- `profiles.push_token` has been written by the client since
-- 20260825120000_push_tokens.sql and read by nothing at all. This migration is
-- the reader: three triggers that hand an event to `private.dispatch_push()`,
-- which posts it to the `send-push` Edge Function over `pg_net`.
--
-- WHY pg_net AND NOT A DIRECT CALL. `net.http_post` writes the request into
-- `net.http_request_queue` and returns a request id immediately; a background
-- worker performs the send after the transaction commits. So a chat insert
-- never waits on Expo, and Expo being slow, unreachable or wrong cannot slow a
-- message down. That is the same mechanism the nightly `cleanup-media` job
-- already uses.
--
-- WHY EVERY TRIGGER SWALLOWS ITS OWN ERRORS. A notification is a side effect,
-- and a side effect must never be able to reject the row that caused it. Each
-- trigger body sits inside an `exception when others` block, which in Postgres
-- is a subtransaction: the failed dispatch is rolled back and the INSERT or
-- UPDATE it hangs off still commits. Losing a notification is a nuisance;
-- losing a message because a Vault secret was renamed would be a bug that
-- looks like the chat being broken.
--
-- WHY THIS IS A NO-OP UNTIL THE SECRETS EXIST. `dispatch_push` reads
-- `project_url` and `service_role_key` from Vault, exactly like the media
-- sweep, and returns without sending when either is missing. On the live
-- project **neither has been created** (supabase/README.md §3), so installing
-- this migration changes nothing observable until they are — which is
-- deliberate: a half-configured sender that raised would be worse than one
-- that stays quiet.
--
-- WHY THE COPY IS ENGLISH. A notification body is composed here, server-side,
-- with no `Translator` and no way to know which language the reading device is
-- set to. It joins the database's own `raise exception` strings as the second
-- place FamApp is English regardless of the picked language. The honest fix is
-- the same one that section names: send a message *code* plus its variables and
-- let the client render it — which needs a client that receives pushes at all,
-- and there is not one yet.
--
-- WHAT THIS STILL DOES NOT DO. Nothing here reads `families.is_premium`: the
-- saved-place arrival/departure alerts that the Gold tier sells are a different
-- event source (a fold over `locations`, see `membersAtPlaces`) and are not
-- part of this migration. Chat and tasks notify every registered device in the
-- family, free or not.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. How a member is named in a notification
--
-- Mirrors `memberName()` in `src/data/format.ts`, down to the fallback: a
-- member who has not set a display name reads as "Unnamed member" in the app,
-- and a push that called them something else would be a second identity for
-- the same person.
-- -----------------------------------------------------------------------------
create or replace function private.push_display_name(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $fn$
  select coalesce(
    (select nullif(btrim(p.display_name), '')
       from public.profiles p
      where p.id = p_user_id),
    'Unnamed member'
  );
$fn$;

revoke all on function private.push_display_name(uuid) from public, anon, authenticated;

comment on function private.push_display_name(uuid) is
  'Display name for notification copy, falling back to "Unnamed member" exactly as memberName() does client-side.';


-- -----------------------------------------------------------------------------
-- 2. The dispatch helper
--
-- SECURITY DEFINER for two separate reasons, both required: `vault.
-- decrypted_secrets` is not readable by `authenticated`, and neither is the
-- `net` schema. The caller is whoever inserted the row, so without this the
-- first message any member sent would fail on a permission error inside a
-- trigger.
--
-- `p_recipient_ids` distinguishes NULL from an empty array, and the Edge
-- Function honours the difference: NULL means "the whole family except the
-- sender", `{}` means nobody. Passing an empty array where NULL was meant
-- would notify everyone, so a caller that computed no recipients must skip the
-- call rather than pass its empty result.
-- -----------------------------------------------------------------------------
create or replace function private.dispatch_push(
  p_family_id     uuid,
  p_sender_id     uuid,
  p_recipient_ids uuid[],
  p_title         text,
  p_body          text,
  p_data          jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_url   text;
  v_key   text;
begin
  if p_family_id is null or p_sender_id is null then
    return;
  end if;

  -- An explicit empty list means there is nobody to tell. Sending it would be
  -- a wasted round trip; sending NULL instead would be a wrong one.
  if p_recipient_ids is not null and cardinality(p_recipient_ids) = 0 then
    return;
  end if;

  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'project_url';

  select decrypted_secret into v_key
    from vault.decrypted_secrets where name = 'service_role_key';

  -- Not configured yet (supabase/README.md §3). Quiet, not an error: the rows
  -- this hangs off must commit either way.
  if v_url is null or v_key is null then
    return;
  end if;

  perform net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/send-push',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body := jsonb_build_object(
      'family_id', p_family_id,
      'sender_id', p_sender_id,
      -- to_jsonb of a NULL array is a JSON null, which is what the function
      -- reads as "everyone but the sender".
      'recipient_ids', to_jsonb(p_recipient_ids),
      'title', p_title,
      'body', p_body,
      'data', coalesce(p_data, '{}'::jsonb)
    ),
    timeout_milliseconds := 10000
  );
end;
$fn$;

revoke all on function
  private.dispatch_push(uuid, uuid, uuid[], text, text, jsonb)
from public, anon, authenticated;

comment on function private.dispatch_push(uuid, uuid, uuid[], text, text, jsonb) is
  'Queues one push via pg_net to the send-push Edge Function. Asynchronous, and a no-op until the project_url/service_role_key Vault secrets exist.';


-- -----------------------------------------------------------------------------
-- 3. Chat messages
--
-- `system` rows are skipped. They are the announcements `createTask` writes
-- after the task itself ("Sami created a task"), so notifying on them would
-- buzz every device twice for one task — the task trigger below already owns
-- that event. It is the same reason `deriveActivity` skips them on Home.
--
-- An `image` row has no content to preview by definition (the payload
-- constraint forbids it carrying both), so it gets a fixed line rather than an
-- empty body, which Expo rejects.
-- -----------------------------------------------------------------------------
create or replace function private.notify_on_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_preview text;
begin
  if new.message_type = 'system' then
    return null;
  end if;

  if new.message_type = 'image' then
    v_preview := '📷 Photo';
  else
    v_preview := btrim(coalesce(new.content, ''));

    if v_preview = '' then
      return null;
    end if;

    -- `messages_content_length` caps content at 500; a notification shade
    -- shows far less than that, and the ellipsis is what says so.
    if char_length(v_preview) > 140 then
      v_preview := left(v_preview, 139) || '…';
    end if;
  end if;

  perform private.dispatch_push(
    new.family_id,
    new.sender_id,
    null,
    private.push_display_name(new.sender_id),
    v_preview,
    jsonb_build_object(
      'type', 'message',
      'family_id', new.family_id,
      'message_id', new.id,
      'sender_id', new.sender_id
    )
  );

  return null;
exception
  when others then
    -- The message is already written and is what matters. Record why the
    -- notification did not go and let the insert stand.
    raise warning 'notify_on_message failed for message %: %', new.id, sqlerrm;
    return null;
end;
$fn$;

revoke all on function private.notify_on_message() from public, anon, authenticated;

drop trigger if exists messages_notify_push on public.messages;
create trigger messages_notify_push
  after insert on public.messages
  for each row execute function private.notify_on_message();


-- -----------------------------------------------------------------------------
-- 4. Tasks created
--
-- An assigned task tells one person; a pool task tells the family, because
-- `assigned_to` NULL means anyone may pick it up and nobody has been asked.
-- The two bodies are different sentences on purpose — "asked you to" is a
-- request and "added a task" is an announcement, and a device that receives
-- both wants to be able to tell them apart at a glance.
--
-- A task assigned to yourself notifies nobody: `send-push` excludes the sender
-- from every send, so the recipient list collapses to empty there rather than
-- being special-cased here.
-- -----------------------------------------------------------------------------
create or replace function private.notify_on_task_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_name  text := private.push_display_name(new.created_by);
  v_title text := btrim(new.title);
begin
  if new.assigned_to is not null then
    perform private.dispatch_push(
      new.family_id,
      new.created_by,
      array[new.assigned_to],
      'New task for you',
      v_name || ' asked you to: ' || v_title,
      jsonb_build_object(
        'type', 'task_assigned',
        'family_id', new.family_id,
        'task_id', new.id
      )
    );
  else
    perform private.dispatch_push(
      new.family_id,
      new.created_by,
      null,
      'New family task',
      v_name || ' added a task: ' || v_title,
      jsonb_build_object(
        'type', 'task_created',
        'family_id', new.family_id,
        'task_id', new.id
      )
    );
  end if;

  return null;
exception
  when others then
    raise warning 'notify_on_task_insert failed for task %: %', new.id, sqlerrm;
    return null;
end;
$fn$;

revoke all on function private.notify_on_task_insert() from public, anon, authenticated;

drop trigger if exists tasks_notify_push_insert on public.tasks;
create trigger tasks_notify_push_insert
  after insert on public.tasks
  for each row execute function private.notify_on_task_insert();


-- -----------------------------------------------------------------------------
-- 5. Tasks completed
--
-- Only the creator is told, and only on the transition *into* `completed`. The
-- WHEN clause is what makes that a transition rather than a state: without it
-- every later edit of an already-finished task would fire again.
--
-- `handled_by` is the member who moved it, and it is nullable — a task can
-- reach `completed` without one on a row written before that column was
-- populated. The copy falls back to the task speaking for itself rather than
-- naming "Unnamed member", who in that case is not a person at all.
--
-- `expired` deliberately gets nothing: it is the retention sweep's verdict, it
-- arrives for a whole family's worth of tasks at 30-minute intervals, and a
-- notification for something nobody did would be the app buzzing about its own
-- housekeeping. Note also that the sweep DELETEs rather than setting the
-- status, so there would be no UPDATE to hang it off in any case.
-- -----------------------------------------------------------------------------
create or replace function private.notify_on_task_completed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor uuid := coalesce(new.handled_by, (select auth.uid()));
  v_body  text;
begin
  -- The creator finishing their own task has nobody to tell, so the dispatch
  -- is skipped outright. send-push would reach the same answer by excluding
  -- the sender, but this saves the round trip for the commonest completion.
  if v_actor is not null and v_actor = new.created_by then
    return null;
  end if;

  if new.handled_by is null then
    v_body := btrim(new.title) || ' is done';
  else
    v_body := private.push_display_name(new.handled_by) || ' finished: ' || btrim(new.title);
  end if;

  perform private.dispatch_push(
    new.family_id,
    -- The actor is the sender, which is what makes send-push exclude them.
    -- With no actor at all — `handled_by` NULL and no `auth.uid()`, i.e. a
    -- server-side write — the nil uuid stands in: it matches no profile, so
    -- the creator is still told rather than being excluded as their own
    -- sender, which is what naming them here would do.
    coalesce(v_actor, '00000000-0000-0000-0000-000000000000'::uuid),
    array[new.created_by],
    'Task completed',
    v_body,
    jsonb_build_object(
      'type', 'task_completed',
      'family_id', new.family_id,
      'task_id', new.id
    )
  );

  return null;
exception
  when others then
    raise warning 'notify_on_task_completed failed for task %: %', new.id, sqlerrm;
    return null;
end;
$fn$;

revoke all on function private.notify_on_task_completed() from public, anon, authenticated;

drop trigger if exists tasks_notify_push_completed on public.tasks;
create trigger tasks_notify_push_completed
  after update of status on public.tasks
  for each row
  when (old.status is distinct from new.status and new.status = 'completed')
  execute function private.notify_on_task_completed();
