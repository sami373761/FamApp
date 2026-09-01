// send-push — the sender half of push notifications.
//
// `profiles.push_token` has existed since 20260825120000 and nothing read it:
// registering a device was the half a client can own, and this is the other
// half. It is invoked by the triggers in 20260829100000_push_notification_
// triggers.sql through `pg_net`, which posts and does not wait — so a slow or
// dead Expo API can never hold a chat insert open.
//
// It is a maintenance endpoint like `cleanup-media`: it reads every profile in
// a family regardless of who is asking, so it accepts the service role key and
// nothing else. `verify_jwt` alone would let any anon-key JWT through.
//
// The one write it makes back to the database is the token cleanup. Expo
// answers `DeviceNotRegistered` for a token whose app was uninstalled or whose
// credentials were rotated; that token will never deliver again, so the column
// is NULLed rather than retried nightly forever. Every other Expo error is
// reported and left alone — `MessageRateExceeded` in particular is temporary,
// and clearing a token on it would unregister a working device.

import { createClient } from 'jsr:@supabase/supabase-js@2';

/** Expo accepts at most 100 message objects per request. */
const EXPO_BATCH_SIZE = 100;
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/**
 * Both prefixes are live: `ExponentPushToken[...]` is what `expo-notifications`
 * returns today, `ExpoPushToken[...]` is the newer spelling. A token of any
 * other shape cannot be delivered to, and sending it only earns a per-ticket
 * error, so it is dropped here instead.
 */
const TOKEN_PATTERN = /^Ex(?:po|ponent)PushToken\[[^\]]+\]$/;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

type PushPayload = {
  family_id: string;
  sender_id: string;
  recipient_ids?: string[] | null;
  title: string;
  body: string;
  data?: Record<string, unknown> | null;
};

/** One ticket per message object, returned in the order they were sent. */
type ExpoTicket = {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string } | null;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}

/**
 * Rejects anything the Expo API or the recipient query would choke on later.
 * Returns the parsed payload or the reason it is unusable — the caller answers
 * 400, because a malformed body is the trigger's bug, not a transient failure
 * worth the cron-style retry a 500 would suggest.
 */
function parsePayload(raw: unknown): { payload: PushPayload } | { error: string } {
  if (typeof raw !== 'object' || raw === null) return { error: 'body must be an object' };

  const value = raw as Record<string, unknown>;

  if (!isUuid(value.family_id)) return { error: 'family_id must be a uuid' };
  if (!isUuid(value.sender_id)) return { error: 'sender_id must be a uuid' };
  if (typeof value.title !== 'string' || value.title.length === 0) {
    return { error: 'title must be a non-empty string' };
  }
  if (typeof value.body !== 'string' || value.body.length === 0) {
    return { error: 'body must be a non-empty string' };
  }

  let recipients: string[] | null = null;

  if (value.recipient_ids !== undefined && value.recipient_ids !== null) {
    if (!Array.isArray(value.recipient_ids) || !value.recipient_ids.every(isUuid)) {
      return { error: 'recipient_ids must be an array of uuids' };
    }
    recipients = value.recipient_ids;
  }

  return {
    payload: {
      family_id: value.family_id,
      sender_id: value.sender_id,
      recipient_ids: recipients,
      title: value.title,
      body: value.body,
      data:
        typeof value.data === 'object' && value.data !== null
          ? (value.data as Record<string, unknown>)
          : null,
    },
  };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  // Same reasoning as cleanup-media: verify_jwt lets any project JWT through,
  // including one minted from the publishable key. This reads the whole
  // family's tokens, so it is service role only.
  if (req.headers.get('Authorization') !== `Bearer ${SERVICE_ROLE_KEY}`) {
    return json({ error: 'forbidden' }, 403);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json({ error: 'invalid json' }, 400);
  }

  const parsed = parsePayload(raw);
  if ('error' in parsed) return json({ error: parsed.error }, 400);

  const { family_id, sender_id, recipient_ids, title, body, data } = parsed.payload;

  // An explicit but empty recipient list means "nobody", which is a legitimate
  // outcome (a pool task in a family of one). Answering it with a query would
  // turn it into "everybody", which is the opposite.
  if (recipient_ids && recipient_ids.length === 0) {
    return json({ recipients: 0, sent: 0, failed: 0, tokensCleared: 0 });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // The family filter is the boundary, not an optimisation: a recipient_ids
  // list arriving from anywhere must never reach a device outside the family
  // the event happened in. Excluding the sender is done here rather than in
  // the trigger so every caller gets it for free.
  let query = supabase
    .from('profiles')
    .select('id, push_token')
    .eq('family_id', family_id)
    .neq('id', sender_id)
    .not('push_token', 'is', null);

  if (recipient_ids) query = query.in('id', recipient_ids);

  const { data: rows, error: selectError } = await query;

  if (selectError) {
    return json({ error: 'recipient lookup failed', detail: selectError.message }, 500);
  }

  // Two accounts signed in on one device share a token. Deduplicating keeps
  // that device to one buzz, and a DeviceNotRegistered on it correctly clears
  // both rows below, since the cleanup matches on the token value.
  const tokens = [
    ...new Set(
      (rows ?? [])
        .map((row) => (row.push_token ?? '').trim())
        .filter((token) => TOKEN_PATTERN.test(token)),
    ),
  ];

  if (tokens.length === 0) {
    return json({ recipients: rows?.length ?? 0, sent: 0, failed: 0, tokensCleared: 0 });
  }

  const stale: string[] = [];
  const errors: string[] = [];
  let sent = 0;

  for (const batch of chunk(tokens, EXPO_BATCH_SIZE)) {
    // One message object per token rather than one object with a `to` array:
    // that is what makes the ticket list index-for-index with `batch`, which
    // is the only way to know *which* token Expo rejected.
    const messages = batch.map((to) => ({
      to,
      title,
      body,
      data: data ?? {},
      sound: 'default',
      priority: 'high',
      // Android needs a channel or the notification arrives silent; the
      // client creates none, so this is the platform default channel.
      channelId: 'default',
    }));

    let response: Response;
    try {
      response = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'Accept-Encoding': 'gzip, deflate',
        },
        body: JSON.stringify(messages),
      });
    } catch (cause) {
      // Expo unreachable. Nothing in this batch was delivered and no token is
      // implicated, so the batch is reported and the rest still go out.
      errors.push(`request failed: ${cause instanceof Error ? cause.message : String(cause)}`);
      continue;
    }

    if (!response.ok) {
      errors.push(`expo responded ${response.status}: ${(await response.text()).slice(0, 300)}`);
      continue;
    }

    let tickets: ExpoTicket[] = [];
    try {
      const parsedBody = (await response.json()) as {
        data?: ExpoTicket[];
        errors?: { message?: string }[];
      };

      // A request-level failure comes back as `errors` with no `data` at all.
      if (parsedBody.errors?.length) {
        errors.push(
          parsedBody.errors.map((e) => e.message ?? 'unknown expo error').join('; '),
        );
        continue;
      }

      tickets = parsedBody.data ?? [];
    } catch {
      errors.push('expo returned a body that is not json');
      continue;
    }

    tickets.forEach((ticket, index) => {
      if (ticket.status === 'ok') {
        sent += 1;
        return;
      }

      const code = ticket.details?.error;

      // The only permanent, token-specific failure Expo reports. Everything
      // else (MessageRateExceeded, MessageTooBig, InvalidCredentials) is
      // about this send or this project, not about the device.
      if (code === 'DeviceNotRegistered') {
        stale.push(batch[index]);
        return;
      }

      errors.push(`${code ?? 'error'}: ${ticket.message ?? 'no message'}`);
    });
  }

  let tokensCleared = 0;

  if (stale.length > 0) {
    // The guard in `private.guard_profile_columns()` refuses a push_token
    // written onto somebody else's row, but it exempts service_role — which
    // is what lets this clear a token nobody's device can any longer own.
    const { data: cleared, error: clearError } = await supabase
      .from('profiles')
      .update({ push_token: null })
      .in('push_token', stale)
      .select('id');

    if (clearError) {
      errors.push(`token cleanup failed: ${clearError.message}`);
    } else {
      tokensCleared = cleared?.length ?? 0;
    }
  }

  // Always 200 when the recipients were found and the batches were attempted.
  // pg_net records the response and nothing reads it, so a 500 here would only
  // fill `net._http_response` with rows that mean "one device is uninstalled".
  return json({
    recipients: rows?.length ?? 0,
    tokens: tokens.length,
    sent,
    failed: tokens.length - sent,
    tokensCleared,
    errors: errors.length > 0 ? errors : undefined,
  });
});
