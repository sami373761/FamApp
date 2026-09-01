-- =============================================================================
-- FamApp — data retention (TTL) functions and their schedules
--
--   images        10 days  -> cleanup-media Edge Function (rows + storage bytes)
--   text/system   30 days  -> cleanup_expired_text_messages()
--   tasks         on expiry-> cleanup_expired_tasks()
--   photo counter nightly  -> reset_daily_photo_counts()
--
-- pg_cron requires a Supabase plan that allows background workers (Pro+). On a
-- Free project everything below still installs; only the cron.schedule calls at
-- the bottom will fail, and the functions can be driven by any external
-- scheduler instead.
-- =============================================================================

create extension if not exists pg_net;
create extension if not exists pg_cron;


-- -----------------------------------------------------------------------------
-- 1. Retention functions
--
-- SECURITY DEFINER so cron (and only cron) can reach across every family.
-- EXECUTE is revoked from clients — an authenticated user must never be able to
-- call these.
-- -----------------------------------------------------------------------------

-- Text and system messages: 30 days.
-- Image rows are excluded here; they belong to the 10-day media sweep, which
-- has to delete the stored bytes as well.
create or replace function public.cleanup_expired_text_messages()
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_deleted integer;
begin
  delete from public.messages
   where message_type in ('text', 'system')
     and media_url is null
     and created_at < now() - interval '30 days';

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$fn$;

comment on function public.cleanup_expired_text_messages() is
  'TTL: removes text/system messages older than 30 days. Returns the row count.';


-- Uncompleted tasks past their expiry.
create or replace function public.cleanup_expired_tasks()
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_deleted integer;
begin
  delete from public.tasks
   where status <> 'completed'
     and expires_at < now();

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$fn$;

comment on function public.cleanup_expired_tasks() is
  'TTL: removes uncompleted tasks whose expires_at has passed. Returns the row count.';


-- Nightly reset of the per-user photo allowance.
create or replace function public.reset_daily_photo_counts()
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_reset integer;
begin
  update public.profiles
     set daily_photo_count = 0
   where daily_photo_count <> 0;

  get diagnostics v_reset = row_count;
  return v_reset;
end;
$fn$;

comment on function public.reset_daily_photo_counts() is
  'Zeroes daily_photo_count for every profile. Scheduled at 00:00 UTC.';


-- Fallback for the media sweep when the Edge Function is not deployed.
--
-- This drops the message rows and their storage.objects rows, which is enough
-- to make the media unreachable, but it does NOT free the bytes in the storage
-- backend. Prefer the `cleanup-media` Edge Function, which calls the Storage
-- API and removes the objects properly.
create or replace function public.cleanup_expired_media_rows()
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_deleted integer;
begin
  -- Both data-modifying CTEs run to completion regardless of what the outer
  -- query reads, so the storage rows go even though only `expired` is counted.
  with expired as (
    delete from public.messages
     where message_type = 'image'
       and created_at < now() - interval '10 days'
    returning media_url
  ),
  purged as (
    delete from storage.objects o
     using expired e
     where o.bucket_id = 'chat-media'
       and o.name = e.media_url
    returning o.id
  )
  select count(*) into v_deleted from expired;

  return v_deleted;
end;
$fn$;

comment on function public.cleanup_expired_media_rows() is
  'Fallback TTL for image messages (10 days). Leaves storage bytes behind — use the cleanup-media Edge Function instead.';


revoke all on function
  public.cleanup_expired_text_messages(),
  public.cleanup_expired_tasks(),
  public.reset_daily_photo_counts(),
  public.cleanup_expired_media_rows()
from public, anon, authenticated;

grant execute on function
  public.cleanup_expired_text_messages(),
  public.cleanup_expired_tasks(),
  public.reset_daily_photo_counts(),
  public.cleanup_expired_media_rows()
to service_role;


-- -----------------------------------------------------------------------------
-- 2. Schedules
--
-- Re-running this migration replaces the jobs rather than duplicating them.
-- -----------------------------------------------------------------------------
do $cron$
declare
  v_job text;
begin
  foreach v_job in array array[
    'famapp-cleanup-text-messages',
    'famapp-cleanup-media-messages',
    'famapp-cleanup-expired-tasks',
    'famapp-reset-daily-photo-counts'
  ] loop
    if exists (select 1 from cron.job j where j.jobname = v_job) then
      perform cron.unschedule(v_job);
    end if;
  end loop;
end;
$cron$;

-- 03:15 UTC daily — text/system messages past 30 days.
select cron.schedule(
  'famapp-cleanup-text-messages',
  '15 3 * * *',
  $job$ select public.cleanup_expired_text_messages(); $job$
);

-- Every 30 minutes — expired tasks, so the boards stay accurate through the day.
select cron.schedule(
  'famapp-cleanup-expired-tasks',
  '*/30 * * * *',
  $job$ select public.cleanup_expired_tasks(); $job$
);

-- Midnight UTC — daily photo allowance.
select cron.schedule(
  'famapp-reset-daily-photo-counts',
  '0 0 * * *',
  $job$ select public.reset_daily_photo_counts(); $job$
);

-- 03:30 UTC daily — images past 10 days, via the Edge Function so the bytes go
-- too. The WHERE clause makes this a no-op until both Vault secrets exist, so
-- the job never errors on a project that has not been configured yet.
select cron.schedule(
  'famapp-cleanup-media-messages',
  '30 3 * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/cleanup-media',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  )
  where exists (select 1 from vault.decrypted_secrets where name = 'project_url')
    and exists (select 1 from vault.decrypted_secrets where name = 'service_role_key');
  $job$
);
