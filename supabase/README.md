# FamApp — Supabase backend

Project ref: `mdgjzuczzjxlbivcbdnp` · API URL: `https://mdgjzuczzjxlbivcbdnp.supabase.co`

```
migrations/20260730120000_init_famapp_schema.sql       tables, triggers, RLS, RPCs, storage bucket
migrations/20260730120100_retention_and_cron.sql       TTL functions + pg_cron schedules
migrations/20260730120200_fix_media_cleanup_fallback.sql
migrations/20260730120300_harden_role_privileges.sql   strips anon + TRUNCATE from the API roles
migrations/20260829100000_push_notification_triggers.sql  chat/task triggers -> send-push
functions/cleanup-media/index.ts                       10-day image sweep (rows + storage bytes)
functions/send-push/index.ts                           Expo push sender (+ dead-token cleanup)
```

**All migrations are applied to `mdgjzuczzjxlbivcbdnp`, both Edge Functions are deployed, and
the two Vault secrets exist.** The media sweep and the push dispatcher are therefore both live —
sections 3 and 3a are now reference, not to-do. Outstanding before this faces real users:
closing the `push_token` read exposure (§3a), and turning email confirmation back on (§4) plus
its email template (§5). Sign-up is deliberately unverified right now so development does not
need an inbox.

The CLI is not installed globally; every command below uses `npx supabase`.

## 1. Link the project

Already linked. On a fresh machine:

```bash
npx supabase login                                     # needs a TTY, or use --token
npx supabase link --project-ref mdgjzuczzjxlbivcbdnp
```

## 2. Push the schema

```bash
npx supabase db push --dry-run   # review
npx supabase db push
```

To reset a local stack instead (needs Docker running):
`npx supabase start && npx supabase db reset`.

`pg_cron` needs a plan with background workers. It installed fine on this project, but on a
Free project the second migration fails at `create extension pg_cron` — drop the
`select cron.schedule(...)` block and drive the four functions from an external scheduler.

## 3. Media cleanup — DONE (secrets present, job active)

Without it, image messages are never purged. Two Vault secrets tell the cron job where to
send the request — run this in the SQL editor:

```sql
select vault.create_secret('https://mdgjzuczzjxlbivcbdnp.supabase.co', 'project_url');
select vault.create_secret('<service-role-key>', 'service_role_key');
```

The function itself is deployed (`npx supabase functions deploy cleanup-media` to redeploy).
**Both secrets now exist**, so the 03:30 UTC job really calls it and images really are purged at
10 days — this section documented a no-op for a long time and no longer does. Confirm with
`select name from vault.decrypted_secrets;` rather than trusting this paragraph. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected into the
function automatically — do not set those yourself.

The Edge Function is the **only** complete media sweep. Hosted Supabase rejects direct DML
on the storage tables, so SQL cannot free the bytes at all —
`public.cleanup_expired_media_rows()` is a partial fallback that drops the expired message
rows and leaves the objects in the bucket.

## 3a. Push notifications — server side DONE, no device can receive yet

`profiles.push_token` is written by the app's Notifications switch and, as of
`20260829100000_push_notification_triggers.sql`, read by three triggers:

| trigger | fires on | who is told |
| --- | --- | --- |
| `messages_notify_push` | INSERT of a `text` or `image` message | the family, minus the sender |
| `tasks_notify_push_insert` | INSERT on `tasks` | the assignee, or the family for a pool task |
| `tasks_notify_push_completed` | `status` -> `completed` | the task's creator |

`system` messages are skipped — they are the announcements `createTask` writes, and the task
trigger already covers that event.

Each one calls `private.dispatch_push()`, which posts to the `send-push` Edge Function over
`pg_net` and does **not** wait for it. Deploy the function and push the migration:

```bash
npx supabase db push
npx supabase functions deploy send-push
```

**The two Vault secrets from section 3 are what switch this on, and they are present.**
`dispatch_push` reads the same `project_url` / `service_role_key` pair the media sweep does and
returns without sending when either is missing, so a forked or restored project without them
installs and fires and queues nothing. On `mdgjzuczzjxlbivcbdnp` the path is **verified end to
end**: a real message insert queued a request that came back HTTP 200 with
`{"recipients":0,...}` — 0 because no profile has a token, not because anything failed. Check
`net._http_response` after an insert to re-confirm.

Three things worth knowing before expecting a device to buzz:

- **The app cannot receive one yet, and this is the only thing left.** `app.json` has no
  `extra.eas.projectId` and development happens in Expo Go, where remote push was removed in
  SDK 53. So `push_token` is NULL on all 7 profiles and `send-push` correctly finds nobody to
  notify. A development build from an `eas init`'d project is what changes that — see the Push
  notifications section of CLAUDE.md.
- **Notification copy is English**, composed in SQL with no `Translator` in reach. It joins
  the database's `raise exception` strings as the second place FamApp ignores the language
  picker. Fixing it means sending a message code plus its variables and rendering client-side.
- **Read exposure is still open.** `profiles: read own and family` is family-wide, so every
  member of your family can read your push token, and a token is a send capability. That was
  tolerable while nothing sent; a sender is now deployed, so close it (column privileges plus
  explicit column lists in `familyService`, or a `push_tokens` table with an own-row policy)
  before this faces real users. The write side is already closed by
  `guard_profile_columns()`.

A dead token cleans itself up: Expo answers `DeviceNotRegistered` for an uninstalled app, and
`send-push` NULLs that column. Every other Expo error is reported and the token left alone —
`MessageRateExceeded` is temporary, and clearing on it would unregister a working device.

## 4. Email confirmation — currently OFF for development

Sign-up is set up to hand out a session immediately: no code, no link. That is a **server**
setting (`mailer_autoconfirm`), not a client one — there is no supabase-js flag for it, and
`signInWithPassword` straight after a signup fails with `email_not_confirmed` while it is on.

```bash
export SUPABASE_ACCESS_TOKEN=sbp_...        # dashboard -> Account -> Access Tokens
npm run auth:config                          # read current state, changes nothing
npm run auth:config -- --confirmations off   # development: instant sign-in
npm run auth:config -- --confirmations on --otp-template   # production: 6-digit code
```

Equivalent by hand: Authentication → Sign In / Providers → Email → **Confirm email**.

Three things worth knowing:

- **It only affects new sign-ups.** Accounts created while confirmation was on stay
  unconfirmed forever, and signing in to one still fails with `EMAIL_NOT_CONFIRMED`. Use a
  fresh address, click the old link, or delete the user under Authentication → Users.
- **The OTP path is not deleted, just dormant.** `verifyEmailOtp` and the verify step in
  `sign-up.tsx` are reached off `needsEmailConfirmation`, so turning confirmation back on
  restores them with no code change. Section 5 is still required for that.
- **Anyone can register an address they do not own** while this is off. It is a development
  convenience, not a configuration to ship.

## 5. Sign-up email template — required whenever confirmation is ON

Sign-up verifies a **6-digit code entered in the app**, not a link. The client side is done
(`verifyEmailOtp` in `src/services/authService.ts`, the verify step in `src/app/sign-up.tsx`),
but it only has something to type if the project's **Confirm signup** email renders the token.

`signUp` always mints both a 6-digit OTP and a confirmation URL wrapping that same token —
**the template is the only thing that picks which one the user sees**, so this is a dashboard
change, not a migration. Until it is made, new users still receive a link and the verify
screen has no code to accept.

Dashboard → **Authentication → Emails → Confirm signup**, and replace the body with
`supabase/templates/confirmation.html` (subject: `Your FamApp verification code`). The one
line that matters:

```html
<span>{{ .Token }}</span>
```

**Do not leave `{{ .ConfirmationURL }}` in alongside it.** Following the link confirms the
account in a browser that holds no app session, spending the token and leaving the app on a
code that no longer works.

`npx supabase config push` would apply the same thing from `config.toml`, where the template
is now declared — but it pushes the **whole** auth config, and this file is otherwise stock
CLI defaults that do not describe the live project (`site_url` is still
`http://127.0.0.1:3000`). Reconcile those before ever running it; the dashboard edit is the
safe route.

This section only matters once confirmation is back **on** (section 4). While it is off,
GoTrue returns a session straight from `signUp` and sends nothing at all, so the template is
never rendered — applying it early is harmless and costs nothing later.

## Scheduled jobs

| Job | Schedule (UTC) | Does |
| --- | --- | --- |
| `famapp-cleanup-text-messages` | `15 3 * * *` | deletes text/system messages older than 30 days |
| `famapp-cleanup-media-messages` | `30 3 * * *` | calls `cleanup-media`: images older than 10 days |
| `famapp-cleanup-expired-tasks` | `*/30 * * * *` | deletes uncompleted tasks past `expires_at` |
| `famapp-reset-daily-photo-counts` | `0 0 * * *` | zeroes `profiles.daily_photo_count` |

Inspect with `select jobname, schedule, active from cron.job;` and check runs in
`cron.job_run_details`. Re-running the migration replaces the jobs rather than duplicating
them.

## Client contract

Membership changes go through RPCs, not table writes — RLS hides a family from anyone who
is not already in it, so a joiner cannot look one up by code.

```ts
await supabase.rpc('create_family', { p_role: 'parent' })   // -> families row, caller becomes admin
await supabase.rpc('join_family',   { p_join_code: 'K7RM2P' })
await supabase.rpc('remove_member', { p_member_id: id })    // admin only
```

Everything else is ordinary PostgREST against `profiles`, `families`, `locations`,
`messages` and `tasks`, scoped automatically to the caller's family.

- **Leaving** a family is `update profiles set family_id = null where id = auth.uid()`.
  **Kicking** must use `remove_member` — see the comment above the function for why a plain
  UPDATE cannot work.
- `is_admin`, `daily_photo_count` and `created_at` are server-managed; writes are rejected.
- `messages.media_url` stores the **object path** inside the private `chat-media` bucket,
  formatted `<family_id>/<user_id>/<uuid>.<ext>`. Storage policies enforce that layout, and
  the cleanup function relies on it.
- `tasks.expires_at` may be omitted — it is derived from `duration_type`.
- Realtime is enabled on `messages`, `tasks`, `locations` and `profiles`.

## Generating types

```bash
npx supabase gen types typescript --linked > src/data/database.types.ts
```

`src/services/` maps these rows onto the domain types in `src/data/types.ts`, which is what
every screen renders — there are no fixtures left.
