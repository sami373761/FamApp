#!/usr/bin/env node
/**
 * Reads and flips the live project's auth config through the Management API.
 *
 * Exists because two things sign-up depends on are server-side settings with no
 * client equivalent, and the Supabase CLI can only push them as part of the
 * *whole* config.toml — which is still stock defaults that do not describe this
 * project (`site_url` is `127.0.0.1:3000`). This touches named fields only.
 *
 *   node scripts/supabase-auth-config.mjs                      # read current state
 *   node scripts/supabase-auth-config.mjs --confirmations off  # instant sign-up, no code
 *   node scripts/supabase-auth-config.mjs --confirmations on --otp-template
 *
 * Needs `SUPABASE_ACCESS_TOKEN` (dashboard -> Account -> Access Tokens). Writing
 * anything requires an explicit flag: a bare run never changes the project.
 */

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PROJECT_REF = 'mdgjzuczzjxlbivcbdnp';
const ENDPOINT = `https://api.supabase.com/v1/projects/${PROJECT_REF}/config/auth`;
const TEMPLATE = join(dirname(fileURLToPath(import.meta.url)), '../supabase/templates/confirmation.html');
const SUBJECT = 'Your FamApp verification code';

const args = process.argv.slice(2);
const flag = (name) => {
  const index = args.indexOf(name);

  return index === -1 ? null : (args[index + 1] ?? '');
};

const confirmations = flag('--confirmations');
const applyTemplate = args.includes('--otp-template');

if (confirmations !== null && !['on', 'off'].includes(confirmations)) {
  exit('--confirmations takes "on" or "off".');
}

function exit(message) {
  console.error(message);
  process.exit(1);
}

async function call(method, body) {
  const token = process.env.SUPABASE_ACCESS_TOKEN;

  if (!token) exit('SUPABASE_ACCESS_TOKEN is not exported. See the header of this file.');

  const response = await fetch(ENDPOINT, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) exit(`HTTP ${response.status}: ${(await response.text()).slice(0, 400)}`);

  return response.json();
}

function describe(config) {
  const template = config.mailer_templates_confirmation_content ?? '';
  const hasToken = template.includes('{{ .Token }}');
  const hasLink = template.includes('{{ .ConfirmationURL }}');

  const templateState = !template
    ? 'Supabase default (confirmation LINK, no code)'
    : hasToken && !hasLink
      ? 'custom, renders the 6-digit code'
      : hasToken
        ? 'custom, but STILL contains {{ .ConfirmationURL }} — remove it'
        : 'custom, renders a link and no code';

  console.log(`  email confirmation required : ${!config.mailer_autoconfirm}`);
  console.log(`  confirm-signup template     : ${templateState}`);
  console.log(`  otp length                  : ${config.mailer_otp_length}`);
  console.log(`  custom smtp                 : ${config.smtp_host || 'none (built-in, rate limited)'}`);
}

console.log('Current:');
describe(await call('GET'));

if (confirmations === null && !applyTemplate) {
  console.log('\nRead-only run. Pass --confirmations on|off and/or --otp-template to change anything.');
  process.exit(0);
}

const patch = {};

if (confirmations !== null) patch.mailer_autoconfirm = confirmations === 'off';

if (applyTemplate) {
  const content = await readFile(TEMPLATE, 'utf8');

  if (!content.includes('{{ .Token }}')) {
    exit(`${TEMPLATE} does not render {{ .Token }} — refusing to apply it.`);
  }

  patch.mailer_templates_confirmation_content = content;
  patch.mailer_subjects_confirmation = SUBJECT;
  patch.mailer_otp_length = 6;
}

console.log('\nApplying:', Object.keys(patch).join(', '));
await call('PATCH', patch);

console.log('\nNow:');
describe(await call('GET'));

if (patch.mailer_autoconfirm === true) {
  console.log(
    [
      '',
      'Sign-ups from here on get a session immediately — no code, no link.',
      '',
      'This applies to NEW sign-ups only. Accounts already created while',
      'confirmation was on stay unconfirmed, and signing in to one still fails',
      'with EMAIL_NOT_CONFIRMED. Use a fresh address, click the old link, or',
      'delete the user in Authentication -> Users.',
      '',
      'Anyone can now register an address they do not own. Turn it back on with',
      '--confirmations on before this project faces real users.',
    ].join('\n'),
  );
}
