/**
 * Family logistics: create, join, read, kick, and the caller's own profile.
 *
 * Membership never moves through a plain table write. RLS hides a family from
 * anyone who is not already in it, so a joiner cannot look one up by code, and
 * clearing a member's `family_id` makes their row invisible to the admin doing
 * the clearing (Postgres re-checks SELECT policies against the new row). All
 * three transitions are therefore SECURITY DEFINER RPCs. See
 * `supabase/migrations/20260730120000_init_famapp_schema.sql`.
 *
 * Nothing here throws. Every call resolves to a `ServiceResult`, and the
 * database's own error messages are already written for humans, so they are
 * passed through unless they would leak internals.
 */

import type { PostgrestError } from '@supabase/supabase-js';

import { parseAvatarConfig, type AvatarConfig } from '@/data/avatar';
import type { Database } from '@/data/database.types';
import { initialsFrom, presenceFrom } from '@/data/format';
import type { Family, FamilyMember, FamilyRole, MemberLocation } from '@/data/types';
import { listLocations } from '@/services/locationService';
import {
  fail,
  errorFrom,
  guarded,
  ok,
  type CommonErrorCode,
  type ServiceError,
  type ServiceResult,
} from '@/services/result';
import { supabase } from '@/services/supabase';

type Row<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row'];

export type FamilyRow = Row<'families'>;
export type ProfileRow = Row<'profiles'>;

/** Everything the tabs need about who is in the family. */
export type FamilyOverview = {
  family: Family;
  /** Admins first, then oldest profile first. */
  members: FamilyMember[];
};

export type FamilyErrorCode =
  | CommonErrorCode
  | 'ALREADY_IN_FAMILY'
  | 'FAMILY_FULL'
  | 'INVALID_JOIN_CODE'
  | 'NOT_ADMIN'
  | 'NOT_A_MEMBER'
  | 'CANNOT_REMOVE_SELF'
  | 'NOT_FOUND';

export type FamilyServiceError = ServiceError<FamilyErrorCode>;
export type FamilyResult<T> = ServiceResult<T, FamilyErrorCode>;

/** Generated codes avoid I/O/0/1, but accept anything the column allows. */
const JOIN_CODE_PATTERN = /^[A-Z0-9]{6}$/;

/** `profiles.role` is free text; anything else is reported as no role at all. */
export const FAMILY_ROLES: readonly FamilyRole[] = ['parent', 'child', 'guardian'];

/**
 * Narrows a stored `profiles.role` onto the vocabulary the UI writes. Exported
 * because the Edit profile screen seeds its picker straight from the raw row
 * rather than waiting for the family overview to load.
 */
export function toFamilyRole(value: unknown): FamilyRole | null {
  return FAMILY_ROLES.find((candidate) => candidate === value) ?? null;
}

const failWith = <T>(error: PostgrestError): FamilyResult<T> => ({
  data: null,
  error: toServiceError(error),
});

/**
 * Maps a PostgREST failure onto a code the UI can branch on.
 *
 * The interesting cases are the `raise exception ... using errcode` calls in the
 * RPCs; SQLSTATE alone is not enough because several distinct failures share
 * P0001, so the message is matched too.
 */
function toServiceError(error: PostgrestError): FamilyServiceError {
  const message = error.message ?? '';
  const cause = error;

  switch (error.code) {
    case '28000':
      return errorFrom('NOT_AUTHENTICATED', 'errors.notAuthenticated', cause);

    /*
      The three matched below are `raise exception` messages the migrations
      wrote for humans ("This family is full (10 of 10 members)"), so they pass
      through as server text and stay English. Giving them catalog keys would
      mean parsing the sentence for its numbers — the honest fix is a message
      code column on the server, which is a schema change, not a client one.
    */
    case 'P0001':
      if (/already belong/i.test(message)) {
        return errorFrom('ALREADY_IN_FAMILY', { text: message }, cause);
      }
      if (/full/i.test(message)) {
        return errorFrom('FAMILY_FULL', { text: message }, cause);
      }
      if (/remove themselves/i.test(message)) {
        return errorFrom('CANNOT_REMOVE_SELF', { text: message }, cause);
      }
      // "Could not allocate a unique join code" — transient, worth retrying.
      return errorFrom('UNKNOWN', 'errors.unknown', cause);

    case 'P0002':
      if (/not in your family/i.test(message)) {
        return errorFrom('NOT_A_MEMBER', { text: message }, cause);
      }
      return errorFrom('INVALID_JOIN_CODE', { text: message }, cause);

    case '42501':
      // `authenticated` holds EXECUTE on all three RPCs and DML on every table;
      // only `anon` is denied outright. So a bare "permission denied for
      // function/table" means there is no session, not a missing role.
      if (/permission denied/i.test(message)) {
        return errorFrom('NOT_AUTHENTICATED', 'errors.notAuthenticated', cause);
      }

      return errorFrom(
        'NOT_ADMIN',
        /admin/i.test(message) ? { text: message } : 'errors.family.forbidden',
        cause,
      );

    // .single() matched no row: either the family is gone or RLS hid it.
    case 'PGRST116':
      return errorFrom('NOT_FOUND', 'errors.family.notFound', cause);

    default:
      return errorFrom('UNKNOWN', 'errors.unknown', cause);
  }
}

export function toFamily(row: FamilyRow): Family {
  return {
    id: row.id,
    name: row.name?.trim() || null,
    joinCode: row.join_code,
    createdAt: row.created_at,
    maxMembers: row.max_members,
    // Carried through as the pair the schema stores. Whether the grant is
    // *live* is `isPremiumActive()` in `src/data/premium.ts`; collapsing the
    // two columns into one boolean here would put the expiry rule in a mapper
    // and leave the client half unable to agree with the SQL half.
    isPremium: row.is_premium,
    premiumUntil: row.premium_until,
  };
}

export function toFamilyMember(row: ProfileRow, location: MemberLocation | null): FamilyMember {
  const displayName = row.display_name?.trim() || null;

  return {
    id: row.id,
    displayName,
    initials: initialsFrom(displayName),
    colorIndex: row.color_index,
    // `avatar_config` is free-form jsonb defaulting to `{}`; anything that is
    // not a complete configuration reads as "no avatar yet".
    avatar: parseAvatarConfig(row.avatar_config),
    role: toFamilyRole(row.role),
    isAdmin: row.is_admin,
    // A `date` column, so PostgREST returns `YYYY-MM-DD` with no time and no
    // zone. Carried through as that string rather than parsed here —
    // `parseDateOnly` in `data/events.ts` turns it into a *local* midnight, and
    // `new Date('1990-05-04')` would make it the 3rd for everybody west of
    // Greenwich.
    birthDate: row.birth_date,
    createdAt: row.created_at,
    location,
    presence: presenceFrom(location),
  };
}

/**
 * The family, its members and everyone's last known position.
 *
 * Locations are a separate query rather than an embedded one: the map refreshes
 * positions on their own cadence, and `locations` carries foreign keys to both
 * `profiles` and `families`, which makes the embed alias ambiguous enough to be
 * worth avoiding.
 */
export async function getFamilyOverview(familyId: string): Promise<FamilyResult<FamilyOverview>> {
  return guarded(async () => {
    const [familyResponse, locationsResult] = await Promise.all([
      supabase.from('families').select('*, members:profiles(*)').eq('id', familyId).single(),
      listLocations(familyId),
    ]);

    const { data, error } = familyResponse;

    if (error) return failWith(error);
    if (!data) return fail('NOT_FOUND', 'errors.family.notFound');
    if (locationsResult.error) return { data: null, error: locationsResult.error };

    const { members, ...family } = data;
    const locations = locationsResult.data;

    return ok({
      family: toFamily(family),
      members: [...members]
        .sort(
          (a, b) =>
            Number(b.is_admin) - Number(a.is_admin) || a.created_at.localeCompare(b.created_at),
        )
        .map((member) => toFamilyMember(member, locations.get(member.id) ?? null)),
    });
  });
}

export type CreateFamilyInput = {
  name: string;
  displayName: string;
  colorIndex: number;
  role?: FamilyRole;
};

/**
 * Creates a family and makes the caller its admin.
 *
 * The join code is generated server-side — it has to be, because uniqueness is
 * settled by the unique index inside a retry loop. There is no way to ask for a
 * specific one. Name and avatar colour ride along on the same call so a family
 * whose creator has no identity can never exist.
 */
export async function createFamily(input: CreateFamilyInput): Promise<FamilyResult<Family>> {
  return guarded(async () => {
    const { data, error } = await supabase.rpc('create_family', {
      p_name: input.name.trim(),
      p_display_name: input.displayName.trim(),
      p_color_index: input.colorIndex,
      ...(input.role ? { p_role: input.role } : {}),
    });

    if (error) return failWith(error);
    if (!data) return fail('UNKNOWN', 'errors.family.notCreated');

    return ok(toFamily(data));
  });
}

export type JoinFamilyInput = {
  joinCode: string;
  displayName: string;
  colorIndex: number;
  role?: FamilyRole;
};

/**
 * Joins the family owning `joinCode`. The 10-member cap is enforced by a
 * trigger, so a full family surfaces here as `FAMILY_FULL`.
 */
export async function joinFamily(input: JoinFamilyInput): Promise<FamilyResult<Family>> {
  const normalised = input.joinCode.trim().toUpperCase();

  // Save a round trip on input that cannot match anything.
  if (!JOIN_CODE_PATTERN.test(normalised)) {
    return fail('INVALID_JOIN_CODE', 'errors.family.codeRequired');
  }

  return guarded(async () => {
    const { data, error } = await supabase.rpc('join_family', {
      p_join_code: normalised,
      p_display_name: input.displayName.trim(),
      p_color_index: input.colorIndex,
      ...(input.role ? { p_role: input.role } : {}),
    });

    if (error) return failWith(error);
    if (!data) {
      return fail('INVALID_JOIN_CODE', {
        key: 'errors.family.codeNotFound',
        vars: { code: normalised },
      });
    }

    return ok(toFamily(data));
  });
}

/**
 * Edits the caller's own row. `family_id`, `is_admin`, `daily_photo_count` and
 * `created_at` are all rejected by `guard_profile_columns()`, so only the five
 * fields a member genuinely owns are offered here.
 *
 * `avatar` is written as a whole object rather than merged: the column is a
 * plain jsonb value with no shape enforced in the database, so the client that
 * knows the current vocabulary is the one that should decide every key.
 */
export async function updateOwnProfile(patch: {
  displayName?: string;
  colorIndex?: number;
  role?: FamilyRole;
  avatar?: AvatarConfig;
  /**
   * `YYYY-MM-DD`, or null to clear it.
   *
   * Null is offered here and nowhere else in this patch, because it is the one
   * field somebody may reasonably want to take back — a name and a colour
   * always have a value, and a role has none until it is set. It belongs in
   * this function rather than in a calendar service for the same reason
   * `display_name` does: it is a fact about the member, not about the family's
   * dates, and `guard_profile_columns()` is a denylist that lets its owner
   * write it.
   */
  birthDate?: string | null;
}): Promise<FamilyResult<ProfileRow>> {
  return guarded(async () => {
    const { data: auth } = await supabase.auth.getUser();

    if (!auth.user) return fail('NOT_AUTHENTICATED', 'errors.notAuthenticated');

    const { data, error } = await supabase
      .from('profiles')
      .update({
        ...(patch.displayName === undefined ? {} : { display_name: patch.displayName.trim() }),
        ...(patch.colorIndex === undefined ? {} : { color_index: patch.colorIndex }),
        ...(patch.role === undefined ? {} : { role: patch.role }),
        ...(patch.avatar === undefined ? {} : { avatar_config: patch.avatar }),
        ...(patch.birthDate === undefined ? {} : { birth_date: patch.birthDate }),
      })
      .eq('id', auth.user.id)
      .select()
      .single();

    if (error) return failWith(error);

    return ok(data);
  });
}

/**
 * Admin-only: burns the family's current join code and returns its replacement.
 *
 * Takes nothing and offers no way to choose the new code, because there is
 * none: `private.guard_family_columns()` rejects every direct write to
 * `join_code`, and uniqueness is settled by the unique index inside the RPC's
 * retry loop. What comes back is the code the database actually stored.
 *
 * The old code stops working the moment this resolves — `join_family` reads the
 * column and nothing caches it — but nobody is ejected: membership is
 * `profiles.family_id`, which this does not touch.
 */
export async function regenerateJoinCode(): Promise<FamilyResult<string>> {
  return guarded(async () => {
    const { data, error } = await supabase.rpc('regenerate_join_code');

    if (error) return failWith(error);
    if (!data) return fail('UNKNOWN', 'errors.family.codeNotChanged');

    return ok(data);
  });
}

/** Admin-only. A member leaves by clearing their own `family_id` instead. */
export async function removeMember(memberId: string): Promise<FamilyResult<null>> {
  return guarded(async () => {
    const { error } = await supabase.rpc('remove_member', { p_member_id: memberId });

    if (error) return failWith(error);

    return ok(null);
  });
}
