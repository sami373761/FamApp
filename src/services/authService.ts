/**
 * Email/password and Google sign-in.
 *
 * Session storage, refresh and persistence are the client's job (see
 * `supabase.ts`) — this module only starts and ends sessions, and translates
 * GoTrue failures into codes the UI can branch on.
 */

import type { AuthError, Session, User } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import {
  errorFrom,
  fail,
  guarded,
  ok,
  type CommonErrorCode,
  type ServiceError,
  type ServiceResult,
} from '@/services/result';
import { SUPABASE_ANON_KEY, SUPABASE_URL, supabase } from '@/services/supabase';

export type AuthErrorCode =
  | CommonErrorCode
  | 'INVALID_CREDENTIALS'
  | 'EMAIL_NOT_CONFIRMED'
  | 'EMAIL_TAKEN'
  | 'INVALID_EMAIL'
  | 'INVALID_OTP'
  | 'WEAK_PASSWORD'
  | 'RATE_LIMITED'
  | 'SIGNUP_DISABLED'
  | 'PROVIDER_DISABLED'
  | 'OAUTH_CANCELLED'
  | 'DELETE_UNAVAILABLE';

export type AuthResult<T> = ServiceResult<T, AuthErrorCode>;

/**
 * Sign-up does not always produce a session: with email confirmation switched
 * on, GoTrue returns a user and no session until the emailed token is redeemed.
 *
 * That token is a 6-digit OTP, and this app redeems it in-app via
 * `verifyEmailOtp` — see the note there for why the *client* has no say in
 * whether the email carries a code or a link.
 */
export type SignUpOutcome = {
  user: User | null;
  session: Session | null;
  /** True when the caller must enter the emailed code before they have a session. */
  needsEmailConfirmation: boolean;
};

/**
 * GoTrue's `code` is the stable identifier; `message` is prose and changes.
 * Match on code, fall back to the message only where there is no code.
 */
function toAuthError(error: AuthError): ServiceError<AuthErrorCode> {
  const code = error.code ?? '';
  const message = error.message ?? '';

  const mapped = (c: AuthErrorCode, key: Parameters<typeof errorFrom>[1]) =>
    errorFrom(c, key, error);

  switch (code) {
    case 'invalid_credentials':
      return mapped('INVALID_CREDENTIALS', 'errors.auth.invalidCredentials');
    case 'email_not_confirmed':
      return mapped('EMAIL_NOT_CONFIRMED', 'errors.auth.emailNotConfirmed');
    case 'user_already_exists':
    case 'email_exists':
      return mapped('EMAIL_TAKEN', 'errors.auth.emailTaken');
    case 'email_address_invalid':
    case 'validation_failed':
      return mapped('INVALID_EMAIL', 'errors.auth.invalidEmail');
    // GoTrue's own message names the rule that was broken ("password should
    // contain at least one character of each…"), which is more use than our
    // generic line — so it passes through as server text when there is one.
    case 'weak_password':
      return mapped('WEAK_PASSWORD', message ? { text: message } : 'errors.auth.weakPassword');
    // GoTrue answers a wrong *or* stale code with the same 403 `otp_expired`;
    // it never says which, so neither can we. Must be matched here rather than
    // left to the 403 fallback below, which would call it "sign in to continue".
    case 'otp_expired':
      return mapped('INVALID_OTP', 'errors.auth.invalidOtp');
    case 'otp_disabled':
      return mapped('PROVIDER_DISABLED', 'errors.auth.otpDisabled');
    // Two very different waits, so they must not share a message. The request
    // limit clears in minutes; the email one is the built-in SMTP's ~2/hour cap
    // and clears in up to an hour. The email cap only applies while email
    // confirmation is on — with it off, signup sends nothing and cannot hit it.
    case 'over_email_send_rate_limit':
      return mapped('RATE_LIMITED', 'errors.auth.emailRateLimited');
    case 'over_request_rate_limit':
      return mapped('RATE_LIMITED', 'errors.auth.rateLimited');
    case 'signup_disabled':
      return mapped('SIGNUP_DISABLED', 'errors.auth.signupsDisabled');
    case 'provider_disabled':
      return mapped('PROVIDER_DISABLED', 'errors.auth.providerDisabled');
    default:
      break;
  }

  // Google provider not configured in the dashboard comes back as a plain 400.
  if (/provider is not enabled/i.test(message)) {
    return mapped('PROVIDER_DISABLED', 'errors.auth.googleDisabled');
  }
  if (error.status === 401 || error.status === 403) {
    return mapped('NOT_AUTHENTICATED', 'errors.notAuthenticated');
  }

  return mapped('UNKNOWN', 'errors.unknown');
}

const failAuth = <T>(error: AuthError): AuthResult<T> => ({
  data: null,
  error: toAuthError(error),
});

export async function signUpWithEmail(email: string, password: string): Promise<AuthResult<SignUpOutcome>> {
  return guarded(async () => {
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
    });

    if (error) return failAuth(error);

    // An already-registered address is NOT an error here. With confirmations on,
    // GoTrue answers a duplicate signup with a *success* carrying an obfuscated
    // user — no session, and `identities: []` — so that an attacker cannot use
    // signup to discover who has an account. It also sends no email whatsoever.
    // Reported as-is that becomes "check your inbox" for a code that will never
    // arrive, so the empty identity list is the only signal available and has to
    // be read here.
    if (data.user && !data.session && data.user.identities?.length === 0) {
      return fail<SignUpOutcome, AuthErrorCode>('EMAIL_TAKEN', 'errors.auth.emailTakenSignIn');
    }

    return ok({
      user: data.user,
      session: data.session,
      needsEmailConfirmation: !data.session && !!data.user,
    });
  });
}

/**
 * Redeems the 6-digit code from the sign-up email for a real session.
 *
 * **Whether that email carries a code or a link is not a client decision.**
 * `signUp` always mints a 6-digit OTP (`auth.email.otp_length`) *and* a
 * confirmation URL that wraps the same token; which one the user sees is
 * decided entirely by the project's "Confirm signup" email template. Ours
 * renders `{{ .Token }}` — see `supabase/templates/confirmation.html`. Swap the
 * template back to `{{ .ConfirmationURL }}` and this function still works, but
 * there is no longer a code in the inbox to type.
 *
 * `type: 'signup'` is the token class, not the delivery channel: it is what
 * distinguishes this from a recovery or email-change token of the same shape.
 * On success GoTrue returns a session and the client persists it, so
 * `onAuthStateChange` moves the user forward on its own — nothing here
 * navigates.
 */
export async function verifyEmailOtp(email: string, token: string): Promise<AuthResult<Session>> {
  return guarded(async () => {
    const { data, error } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: token.trim(),
      type: 'signup',
    });

    if (error) return failAuth(error);
    if (!data.session) return fail('UNKNOWN', 'errors.unknown');

    return ok(data.session);
  });
}

/**
 * Sends a fresh sign-up code, invalidating the previous one.
 *
 * Rejected with `over_email_send_rate_limit` (-> `RATE_LIMITED`) inside the
 * project's `max_frequency` window, which is why the caller runs its own
 * cooldown rather than letting the user discover the limit by hitting it.
 */
export async function resendSignUpOtp(email: string): Promise<AuthResult<null>> {
  return guarded(async () => {
    const { error } = await supabase.auth.resend({ type: 'signup', email: email.trim() });

    if (error) return failAuth(error);

    return ok(null);
  });
}

export async function signInWithEmail(email: string, password: string): Promise<AuthResult<Session>> {
  return guarded(async () => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error) return failAuth(error);
    if (!data.session) return fail('UNKNOWN', 'errors.unknown');

    return ok(data.session);
  });
}

/**
 * Whether the project actually has Google switched on.
 *
 * `signInWithOAuth` does not validate the provider — it just builds an
 * /authorize URL. A disabled provider is only rejected once the browser follows
 * it, and Supabase answers with a 400 JSON body rather than redirecting back.
 * The user would stare at raw JSON and have to dismiss the sheet by hand, which
 * we would then misreport as "cancelled". One cheap public GET avoids all of
 * that. Cached for the session; a failed pre-flight never blocks sign-in.
 */
let googleEnabled: boolean | null = null;

async function isGoogleEnabled(): Promise<boolean> {
  if (googleEnabled !== null) return googleEnabled;

  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/settings`, {
      headers: { apikey: SUPABASE_ANON_KEY },
    });
    const settings = (await response.json()) as { external?: Record<string, boolean> };

    googleEnabled = settings.external?.google ?? true;
  } catch {
    googleEnabled = true;
  }

  return googleEnabled;
}

/**
 * Google OAuth.
 *
 * Web does a normal top-level redirect and resolves with a null session — the
 * page reloads and `detectSessionInUrl` finishes the job. Native opens a system
 * auth session and completes the PKCE exchange by hand, because the redirect
 * lands on a deep link rather than back in this JS context.
 */
export async function signInWithGoogle(): Promise<AuthResult<Session | null>> {
  return guarded(async () => {
    if (!(await isGoogleEnabled())) {
      return fail('PROVIDER_DISABLED', 'errors.auth.googleDisabled');
    }

    if (Platform.OS === 'web') {
      const { error } = await supabase.auth.signInWithOAuth({ provider: 'google' });

      if (error) return failAuth(error);

      return ok(null);
    }

    // `famapp://auth/callback` in a build, an exp:// URL under Expo Go.
    const redirectTo = Linking.createURL('/auth/callback');

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo, skipBrowserRedirect: true },
    });

    if (error) return failAuth(error);
    if (!data.url) return fail('UNKNOWN', 'errors.unknown');

    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);

    // 'cancel' is the user backing out; 'dismiss' is the sheet being swiped away.
    if (result.type !== 'success') {
      return fail('OAUTH_CANCELLED', 'errors.auth.oauthCancelled');
    }

    const params = new URL(result.url).searchParams;
    const returnedError = params.get('error_description') ?? params.get('error');

    if (returnedError) {
      return /provider is not enabled/i.test(returnedError)
        ? fail('PROVIDER_DISABLED', 'errors.auth.googleDisabled')
        // Whatever the provider sent back, in the provider's own words.
        : fail('UNKNOWN', { text: returnedError });
    }

    const code = params.get('code');

    if (!code) return fail('UNKNOWN', 'errors.unknown');

    const exchanged = await supabase.auth.exchangeCodeForSession(code);

    if (exchanged.error) return failAuth(exchanged.error);

    return ok(exchanged.data.session);
  });
}

export async function signOut(): Promise<AuthResult<null>> {
  return guarded(async () => {
    const { error } = await supabase.auth.signOut();

    if (error) return failAuth(error);

    return ok(null);
  });
}

/**
 * Deletes the account for good.
 *
 * The publishable key cannot reach `auth.users`, so the work happens inside
 * `public.delete_account()` — a SECURITY DEFINER RPC that hands any family the
 * caller created to a remaining member before removing the user row, and
 * deletes the family outright when they were its last member. See
 * `supabase/migrations/20260804130000_account_deletion.sql`.
 *
 * The stored session outlives the row it describes — a JWT stays valid until it
 * expires — so it is cleared afterwards. `scope: 'local'` because revoking
 * server-side would 403 on a user that no longer exists, and a failure there
 * must not leave the app holding a session for a deleted account.
 */
export async function deleteAccount(): Promise<AuthResult<null>> {
  return guarded(async () => {
    const { error } = await supabase.rpc('delete_account');

    if (error) {
      // PGRST202 is "no such function": the migration has not been applied.
      if (error.code === 'PGRST202') {
        return fail<null, AuthErrorCode>(
          'DELETE_UNAVAILABLE',
          'errors.auth.deleteUnavailable',
          error,
        );
      }
      if (error.code === '28000' || /permission denied/i.test(error.message ?? '')) {
        return fail<null, AuthErrorCode>('NOT_AUTHENTICATED', 'errors.notAuthenticated', error);
      }

      return fail<null, AuthErrorCode>('UNKNOWN', 'errors.unknown', error);
    }

    await supabase.auth.signOut({ scope: 'local' });

    return ok(null);
  });
}

export async function getCurrentSession(): Promise<AuthResult<Session | null>> {
  return guarded(async () => {
    const { data, error } = await supabase.auth.getSession();

    if (error) return failAuth(error);

    return ok(data.session);
  });
}

/**
 * Revalidates against the auth server rather than trusting the stored session,
 * so a revoked or expired user is reported as signed out.
 */
export async function getCurrentUser(): Promise<AuthResult<User | null>> {
  return guarded(async () => {
    const { data, error } = await supabase.auth.getUser();

    // No stored session at all is a normal signed-out state, not a failure.
    if (error) {
      return error.status === 401 || error.status === 403 ? ok(null) : failAuth(error);
    }

    return ok(data.user);
  });
}
