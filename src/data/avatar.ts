/**
 * Avatars are Tapback memoji, addressed by a random seed.
 *
 * `https://tapback.co/api/avatar/{seed}.webp` renders a deterministic 128×128
 * memoji for any string, so the only thing worth storing is the seed itself —
 * one short token in `profiles.avatar_config`, rather than a URL that would
 * bake today's host and file extension into every row.
 *
 * The column is free-form `jsonb` defaulting to `{}`, so nothing in the
 * database guarantees the shape below. `parseAvatarConfig` is the only way the
 * app reads it: it returns null for anything that is not a usable seed, which
 * is what lets `RootNavigator` treat "no avatar yet" as an onboarding state.
 */

export type AvatarConfig = {
  /** Opaque token; the memoji it renders is whatever the API decides. */
  seed: string;
};

/** Base of the memoji endpoint. The seed and `.webp` are appended. */
const AVATAR_ENDPOINT = 'https://tapback.co/api/avatar';

/**
 * Seeds go into a URL path, so the accepted alphabet is deliberately narrower
 * than "any string" — no escaping to get wrong on either side.
 */
const SEED_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const SEED_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const SEED_LENGTH = 12;

/**
 * A fresh random seed. Length is well past the point where two family members
 * would collide, and the alphabet keeps it readable in a debug log.
 */
export function randomAvatarSeed(): string {
  let seed = '';

  for (let index = 0; index < SEED_LENGTH; index += 1) {
    seed += SEED_ALPHABET[Math.floor(Math.random() * SEED_ALPHABET.length)];
  }

  return seed;
}

export function avatarImageUrl(seed: string): string {
  return `${AVATAR_ENDPOINT}/${seed}.webp`;
}

/** Reads a stored `avatar_config`. Null for `{}` and for any unusable seed. */
export function parseAvatarConfig(value: unknown): AvatarConfig | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;

  const seed = (value as Record<string, unknown>).seed;

  if (typeof seed !== 'string' || !SEED_PATTERN.test(seed)) return null;

  return { seed };
}
