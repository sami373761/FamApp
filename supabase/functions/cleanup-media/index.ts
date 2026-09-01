// cleanup-media — 10-day TTL for chat images.
//
// Invoked nightly by the `famapp-cleanup-media-messages` pg_cron job. Removes
// the objects from the `chat-media` bucket first, then the message rows, so a
// failure mid-run leaves rows pointing at missing files (retried next run)
// rather than orphaned bytes nobody can reach.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const BUCKET = 'chat-media';
const TTL_DAYS = 10;
const BATCH_SIZE = 500;
const REMOVE_CHUNK = 100;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

/**
 * `media_url` is stored as a bare object path, but tolerate a full Storage URL
 * so a client that saved one does not silently skip cleanup forever.
 */
function toObjectPath(mediaUrl: string): string {
  const marker = '/storage/v1/object/';
  const at = mediaUrl.indexOf(marker);

  let path = at === -1 ? mediaUrl : mediaUrl.slice(at + marker.length);
  path = path.split('?')[0];
  path = path.replace(/^\/+/, '');
  path = path.replace(/^(public|sign|authenticated)\//, '');
  path = path.replace(new RegExp(`^${BUCKET}/`), '');

  return decodeURIComponent(path);
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

Deno.serve(async (req) => {
  // verify_jwt lets any valid project JWT through, including an anon-key one.
  // This is a destructive maintenance endpoint: service role only.
  if (req.headers.get('Authorization') !== `Bearer ${SERVICE_ROLE_KEY}`) {
    return json({ error: 'forbidden' }, 403);
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const cutoff = new Date(Date.now() - TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data: expired, error: selectError } = await supabase
    .from('messages')
    .select('id, media_url')
    .eq('message_type', 'image')
    .lt('created_at', cutoff)
    .limit(BATCH_SIZE);

  if (selectError) {
    return json({ error: 'select failed', detail: selectError.message }, 500);
  }

  if (!expired || expired.length === 0) {
    return json({ cutoff, scanned: 0, objectsRemoved: 0, messagesDeleted: 0 });
  }

  const paths = [
    ...new Set(
      expired
        .map((row) => (row.media_url ? toObjectPath(row.media_url) : ''))
        .filter((path) => path.length > 0),
    ),
  ];

  const storageErrors: string[] = [];
  let objectsRemoved = 0;

  for (const batch of chunk(paths, REMOVE_CHUNK)) {
    const { data, error } = await supabase.storage.from(BUCKET).remove(batch);
    if (error) {
      storageErrors.push(error.message);
      continue;
    }
    objectsRemoved += data?.length ?? 0;
  }

  // Keep the rows if storage refused — the next run retries the same batch.
  if (storageErrors.length > 0) {
    return json(
      { error: 'storage removal failed', detail: storageErrors, objectsRemoved },
      500,
    );
  }

  const { error: deleteError } = await supabase
    .from('messages')
    .delete()
    .in('id', expired.map((row) => row.id));

  if (deleteError) {
    return json(
      { error: 'row deletion failed', detail: deleteError.message, objectsRemoved },
      500,
    );
  }

  return json({
    cutoff,
    scanned: expired.length,
    objectsRemoved,
    messagesDeleted: expired.length,
    // BATCH_SIZE caps each run; the schedule drains any backlog over a few days.
    truncated: expired.length === BATCH_SIZE,
  });
});
