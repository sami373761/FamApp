/**
 * The family's saved places.
 *
 * `saved_places` carries three rules the client must never re-implement: the
 * five allowed categories, `unique (user_id, category)` — which is the whole of
 * "at most five places per member" — and, since the premium tier landed, a
 * family-wide ceiling of 2 places on the free tier and 10 on Gold
 * (`private.check_saved_place_limit()`). The composer disables a category the
 * user already holds and the map refuses to open the form past the ceiling, but
 * both are courtesies; the constraint and the trigger are what decide, and each
 * violation is mapped to its own code here — `CATEGORY_TAKEN`, `LIMIT_REACHED` —
 * so the sheet can say which rather than reporting a raw driver error.
 *
 * Reads are family-wide and writes are the author's own, which is exactly what
 * the RLS policies allow — a caller trying to edit somebody else's place gets
 * zero rows back, and that is reported as a refusal rather than as success.
 */

import type { PostgrestError } from '@supabase/supabase-js';

import type { Database } from '@/data/database.types';
import { PLACE_CATEGORIES } from '@/data/places';
import type { PlaceCategory, SavedPlace } from '@/data/types';
import {
  errorFrom,
  fail,
  guarded,
  ok,
  type CommonErrorCode,
  type ServiceError,
  type ServiceResult,
} from '@/services/result';
import { supabase } from '@/services/supabase';

type PlaceRow = Database['public']['Tables']['saved_places']['Row'];

export type PlaceErrorCode =
  | CommonErrorCode
  | 'CATEGORY_TAKEN'
  | 'INVALID_TITLE'
  /** The family is at its tier's ceiling — 2 on free, 10 on Gold. */
  | 'LIMIT_REACHED'
  | 'NOT_A_MEMBER'
  | 'NOT_FOUND';

export type PlaceServiceError = ServiceError<PlaceErrorCode>;
export type PlaceResult<T> = ServiceResult<T, PlaceErrorCode>;

/** Mirrors the `title varchar(40)` column and its `saved_places_title_length` check. */
export const MAX_PLACE_TITLE_LENGTH = 40;

function toServiceError(error: PostgrestError): PlaceServiceError {
  const message = error.message ?? '';
  const cause = error;

  if (error.code === '23505' || /saved_places_one_per_category/.test(message)) {
    return errorFrom('CATEGORY_TAKEN', 'errors.place.categoryTaken', cause);
  }
  if (/saved_places_title_length/.test(message)) {
    return errorFrom(
      'INVALID_TITLE',
      { key: 'errors.place.titleTooLong', vars: { max: MAX_PLACE_TITLE_LENGTH } },
      cause,
    );
  }
  // Two triggers raise P0001 on this table, so the code alone cannot tell them
  // apart and the message decides — the same way `familyService` separates its
  // three. The limit's sentence is matched first because it is the one with a
  // key: the UI answers it with an upgrade prompt rather than by printing the
  // server's count, so this is the one place a P0001 does *not* pass through as
  // text. (`check_saved_place_limit` is what writes that phrase; it is not free
  // to reword on either side.)
  if (error.code === 'P0001' && /saved places limit reached/i.test(message)) {
    return errorFrom('LIMIT_REACHED', 'errors.place.limitReached', cause);
  }
  // The `saved_places_check_family` trigger raises P0001 with a sentence it
  // wrote itself; like every other database message it passes through as text.
  if (error.code === 'P0001') {
    return errorFrom('NOT_A_MEMBER', { text: message }, cause);
  }
  if (error.code === '42501' || /row-level security/i.test(message)) {
    return errorFrom('NOT_A_MEMBER', 'errors.place.notMember', cause);
  }
  if (error.code === '28000') {
    return errorFrom('NOT_AUTHENTICATED', 'errors.notAuthenticated', cause);
  }

  return errorFrom('UNKNOWN', 'errors.unknown', cause);
}

/**
 * `category` is a `text` column to the type generator, so it arrives as a
 * `string`. Narrowing it here rather than casting is what stops a value the
 * check constraint would have rejected — or one added by a later migration the
 * app has not been taught to draw — reaching a screen with no icon.
 */
function toPlaceCategory(value: string): PlaceCategory | null {
  return PLACE_CATEGORIES.find((candidate) => candidate === value) ?? null;
}

export function toSavedPlace(row: PlaceRow): SavedPlace | null {
  const category = toPlaceCategory(row.category);

  if (!category) return null;

  return {
    id: row.id,
    ownerId: row.user_id,
    category,
    title: row.title,
    latitude: row.latitude,
    longitude: row.longitude,
    createdAt: row.created_at,
  };
}

/** Oldest first, so a family's places keep a stable order between renders. */
export async function listPlaces(familyId: string): Promise<PlaceResult<SavedPlace[]>> {
  return guarded(async () => {
    const { data, error } = await supabase
      .from('saved_places')
      .select('*')
      .eq('family_id', familyId)
      .order('created_at', { ascending: true });

    if (error) {
      const failure = toServiceError(error);

      // A read has no category clash and no title to be too long, so anything
      // unrecognised here is simply "the list did not load" — worth saying so
      // rather than falling back to the generic sentence.
      return {
        data: null,
        error:
          failure.code === 'UNKNOWN'
            ? errorFrom('UNKNOWN', 'errors.place.loadFailed', error)
            : failure,
      };
    }

    // A row whose category this build does not know is dropped rather than
    // guessed at — it would otherwise be a pin with no icon and no label.
    return ok(data.flatMap((row) => toSavedPlace(row) ?? []));
  });
}

export type NewPlaceInput = {
  familyId: string;
  category: PlaceCategory;
  title: string;
  latitude: number;
  longitude: number;
};

export async function createPlace(input: NewPlaceInput): Promise<PlaceResult<SavedPlace>> {
  return guarded(async () => {
    const { data: auth } = await supabase.auth.getUser();

    if (!auth.user) return fail('NOT_AUTHENTICATED', 'errors.notAuthenticated');

    const { data, error } = await supabase
      .from('saved_places')
      .insert({
        family_id: input.familyId,
        user_id: auth.user.id,
        category: input.category,
        title: input.title.trim(),
        latitude: input.latitude,
        longitude: input.longitude,
      })
      .select()
      .single();

    if (error) return { data: null, error: toServiceError(error) };

    const place = toSavedPlace(data);

    if (!place) return fail('UNKNOWN', 'errors.place.saveFailed');

    return ok(place);
  });
}

/**
 * What editing a place is allowed to change.
 *
 * Not the family and not the owner: both are pinned by the RLS policy and by
 * `saved_places_check_family`, so offering them would only be offering a write
 * that cannot land.
 */
export type PlacePatch = {
  category?: PlaceCategory;
  title?: string;
  latitude?: number;
  longitude?: number;
};

export async function updatePlace(
  placeId: string,
  patch: PlacePatch,
): Promise<PlaceResult<SavedPlace>> {
  return guarded(async () => {
    const { data, error } = await supabase
      .from('saved_places')
      .update({
        ...(patch.category !== undefined ? { category: patch.category } : {}),
        ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
        ...(patch.latitude !== undefined ? { latitude: patch.latitude } : {}),
        ...(patch.longitude !== undefined ? { longitude: patch.longitude } : {}),
      })
      .eq('id', placeId)
      .select()
      .maybeSingle();

    if (error) return { data: null, error: toServiceError(error) };

    // RLS scopes the update to the author's own rows, so "no row came back"
    // means somebody else's place — or one already deleted. Either way this is
    // a refusal, and reporting it as success would leave the sheet claiming a
    // write that never happened.
    if (!data) return fail('NOT_FOUND', 'errors.place.notFound');

    const place = toSavedPlace(data);

    if (!place) return fail('UNKNOWN', 'errors.place.saveFailed');

    return ok(place);
  });
}

/**
 * Deletes a place. The row is removed rather than flagged: there is no "hidden"
 * column, and a place nobody can see is not a place — the same reasoning that
 * makes `clearOwnLocation` a delete.
 */
export async function deletePlace(placeId: string): Promise<PlaceResult<null>> {
  return guarded(async () => {
    const { error } = await supabase.from('saved_places').delete().eq('id', placeId);

    if (error) return { data: null, error: toServiceError(error) };

    return ok(null);
  });
}
