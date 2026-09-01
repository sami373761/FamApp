/**
 * The shape every service call resolves to.
 *
 * Services never throw and never surface a raw driver error. Callers branch on
 * `error.code` — a closed union per service — and render the message through
 * `errorText(i18n, error)`.
 *
 * **A service does not know what language it is failing in.** It names a
 * catalog key; the screen, which has the `Translator`, turns it into a
 * sentence. That is the same split `error.code` already made — the failure is
 * data, the copy is presentation — and it is why `fail` now takes an
 * `ErrorCopy` rather than a string.
 *
 * `message` is still filled in, always in English. It is the fallback for a
 * server-authored sentence (the database's own "This family is full (10 of 10
 * members)", which has no key and cannot be translated client-side), and it is
 * what a log or a crash report shows. Nothing renders it directly.
 */

import {
  translate,
  type MessageRef,
  type TranslationKey,
  type TranslationVars,
  type Translator,
} from '@/i18n';

/**
 * Failures any service can hit, regardless of what it does. Each service's own
 * code union includes these, which is what lets `guarded` widen a result.
 */
export type CommonErrorCode = 'NOT_AUTHENTICATED' | 'OFFLINE' | 'UNKNOWN';

/**
 * What a service says went wrong: a catalog key on its own, a key with values
 * to fill in, or — only for text the *server* wrote — the sentence itself.
 */
export type ErrorCopy = TranslationKey | MessageRef | { text: string };

export type ServiceError<Code extends string> = {
  code: Code;
  /** English, for logs and as the fallback. Render `errorText` instead. */
  message: string;
  /** Set unless the copy came from the server; what `errorText` resolves. */
  messageKey?: TranslationKey;
  messageVars?: TranslationVars;
  /** The untouched driver error. */
  cause?: unknown;
};

export type ServiceResult<T, Code extends string> =
  | { data: T; error: null }
  | { data: null; error: ServiceError<Code> };

export const ok = <T, Code extends string>(data: T): ServiceResult<T, Code> => ({
  data,
  error: null,
});

/** Splits an `ErrorCopy` into the parts `ServiceError` stores. */
function resolveCopy(copy: ErrorCopy): Pick<ServiceError<string>, 'message' | 'messageKey' | 'messageVars'> {
  if (typeof copy === 'string') {
    return { message: translate('en', copy), messageKey: copy };
  }

  if ('text' in copy) return { message: copy.text };

  return {
    message: translate('en', copy.key, copy.vars),
    messageKey: copy.key,
    messageVars: copy.vars,
  };
}

export const fail = <T, Code extends string>(
  code: Code,
  copy: ErrorCopy,
  cause?: unknown,
): ServiceResult<T, Code> => ({
  data: null,
  error: { code, ...resolveCopy(copy), cause },
});

/** The same construction as `fail`, for a caller building an error in place. */
export const errorFrom = <Code extends string>(
  code: Code,
  copy: ErrorCopy,
  cause?: unknown,
): ServiceError<Code> => ({ code, ...resolveCopy(copy), cause });

/**
 * A service failure as a sentence, in the reader's language.
 *
 * Falls back to `message` — which is either English copy or the server's own
 * words — so a failure always says *something*, even one built before the
 * catalog knew about it.
 */
export function errorText(i18n: Translator, error: ServiceError<string>): string {
  return error.messageKey ? i18n.t(error.messageKey, error.messageVars) : error.message;
}

/**
 * supabase-js reports failures in its return value rather than throwing, but
 * the underlying fetch still can — a dropped connection surfaces as a thrown
 * TypeError, not an error field.
 */
export async function guarded<T, Code extends string>(
  call: () => Promise<ServiceResult<T, Code>>,
): Promise<ServiceResult<T, Code | CommonErrorCode>> {
  try {
    return await call();
  } catch (cause) {
    const offline = cause instanceof TypeError || /network|fetch|timeout/i.test(String(cause));

    return fail<T, CommonErrorCode>(
      offline ? 'OFFLINE' : 'UNKNOWN',
      offline ? 'errors.offline' : 'errors.unknown',
      cause,
    );
  }
}
