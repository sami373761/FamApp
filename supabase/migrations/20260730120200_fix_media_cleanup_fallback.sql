-- =============================================================================
-- Fix: cleanup_expired_media_rows() cannot touch storage.objects
--
-- Hosted Supabase installs a guard that rejects direct DML on the storage
-- tables ("Direct deletion from storage tables is not allowed. Use the Storage
-- API instead."), so the original fallback aborted the whole transaction and
-- deleted nothing at all — including the message rows it could legitimately
-- remove.
--
-- Freeing the stored bytes therefore requires the Storage API, which SQL cannot
-- reach. The `cleanup-media` Edge Function remains the only complete media
-- sweep. This function is narrowed to what SQL can actually do: drop the
-- expired message rows so the chat honours its 10-day retention promise even if
-- the Edge Function is never deployed.
-- =============================================================================

create or replace function public.cleanup_expired_media_rows()
returns integer
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_deleted integer;
begin
  delete from public.messages
   where message_type = 'image'
     and created_at < now() - interval '10 days';

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$fn$;

comment on function public.cleanup_expired_media_rows() is
  'Partial TTL fallback: deletes image message rows older than 10 days. Leaves the objects in the chat-media bucket — only the cleanup-media Edge Function can free those.';

revoke all on function public.cleanup_expired_media_rows() from public, anon, authenticated;
grant execute on function public.cleanup_expired_media_rows() to service_role;
