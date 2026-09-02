/**
 * The family's shared calendar.
 *
 * `family_events` is the dates somebody typed — an anniversary, a school
 * holiday, the day the trip starts. **Birthdays are not here**: a member's
 * birthday is `profiles.birth_date`, folded into the same countdown by
 * `src/data/events.ts`, because a stored copy would go stale the moment
 * somebody corrected their date and would double every birthday for a member
 * the roster already carries.
 *
 * That split is also the tier boundary. Birthdays are a fold over rows every
 * member can already read and stay free for every family, exactly as knowing
 * where the family is stays free; what Gold sells is this table, and
 * `private.check_family_event_limit()` is what enforces it — one event on the
 * free tier, uncapped on Gold. The client half (`eventLimitFor` in
 * `src/data/premium.ts`) explains the ceiling before somebody fills in a form
 * that cannot be saved; it does not enforce it.
 *
 * Reads are family-wide and writes are the author's own, which is what the RLS
 * policies allow — a caller trying to change somebody else's date gets zero
 * rows back, and that is reported as a refusal rather than as success.
 */

import type { PostgrestError } from '@supabase/supabase-js';

import type { Database } from '@/data/database.types';
import type { FamilyEvent, FamilyEventType } from '@/data/types';
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

type EventRow = Database['public']['Tables']['family_events']['Row'];

export type EventErrorCode =
  | CommonErrorCode
  | 'INVALID_TITLE'
  | 'INVALID_DATE'
  /** The family is at its tier's ceiling — 1 on free, uncapped on Gold. */
  | 'LIMIT_REACHED'
  | 'NOT_A_MEMBER'
  | 'NOT_FOUND';

export type EventServiceError = ServiceError<EventErrorCode>;
export type EventResult<T> = ServiceResult<T, EventErrorCode>;

/** Mirrors the `title varchar(60)` column and its `family_events_title_length` check. */
export const MAX_EVENT_TITLE_LENGTH = 60;

/**
 * The five values `family_events_type_valid` allows, in the order the composer
 * offers them. Exported because the form draws a chip per value and the icon
 * table is keyed on the same union.
 */
export const EVENT_TYPES: readonly FamilyEventType[] = [
  'birthday',
  'anniversary',
  'holiday',
  'trip',
  'other',
];

function toServiceError(error: PostgrestError): EventServiceError {
  const message = error.message ?? '';
  const cause = error;

  if (/family_events_title_length/.test(message)) {
    return errorFrom(
      'INVALID_TITLE',
      { key: 'errors.event.titleTooLong', vars: { max: MAX_EVENT_TITLE_LENGTH } },
      cause,
    );
  }
  if (/family_events_type_valid/.test(message) || /invalid input syntax for type date/i.test(message)) {
    return errorFrom('INVALID_DATE', 'errors.event.dateInvalid', cause);
  }
  // Two triggers raise P0001 on this table, so the code alone cannot tell them
  // apart and the message decides — the same shape `placesService` uses. The
  // limit's sentence is matched first because it is the one with a key: the UI
  // answers it with an upgrade prompt rather than by printing the server's
  // count, so this is the one P0001 here that does *not* pass through as text.
  // `check_family_event_limit()` writes that phrase; it is not free to reword
  // on either side.
  if (error.code === 'P0001' && /family events limit reached/i.test(message)) {
    return errorFrom('LIMIT_REACHED', 'errors.event.limitReached', cause);
  }
  // `family_events_check_family` raises P0001 with a sentence it wrote itself;
  // like every other database message it passes through as text.
  if (error.code === 'P0001') {
    return errorFrom('NOT_A_MEMBER', { text: message }, cause);
  }
  if (error.code === '42501' || /row-level security/i.test(message)) {
    return errorFrom('NOT_A_MEMBER', 'errors.event.notMember', cause);
  }
  if (error.code === '28000') {
    return errorFrom('NOT_AUTHENTICATED', 'errors.notAuthenticated', cause);
  }

  return errorFrom('UNKNOWN', 'errors.unknown', cause);
}

/**
 * `event_type` is a `text` column to the type generator, so it arrives as a
 * `string`. Narrowing it rather than casting is what stops a value the check
 * constraint would have rejected — or one added by a later migration this build
 * has not been taught to draw — reaching a card with no icon.
 */
function toEventType(value: string): FamilyEventType | null {
  return EVENT_TYPES.find((candidate) => candidate === value) ?? null;
}

export function toFamilyEvent(row: EventRow): FamilyEvent | null {
  const eventType = toEventType(row.event_type);

  if (!eventType) return null;

  return {
    id: row.id,
    title: row.title,
    // A `date` column, so PostgREST returns `YYYY-MM-DD` with no time and no
    // zone. It is carried through as the string it is rather than parsed here —
    // `parseDateOnly` in `data/events.ts` is what turns it into a *local*
    // midnight, and doing it any other way puts a birthday a day early for
    // everybody west of Greenwich.
    eventDate: row.event_date,
    eventType,
    isAnnual: row.is_annual,
    createdById: row.created_by,
    createdAt: row.created_at,
  };
}

/** Soonest stored date first, so a family's calendar keeps a stable order. */
export async function listEvents(familyId: string): Promise<EventResult<FamilyEvent[]>> {
  return guarded(async () => {
    const { data, error } = await supabase
      .from('family_events')
      .select('*')
      .eq('family_id', familyId)
      .order('event_date', { ascending: true });

    if (error) {
      const failure = toServiceError(error);

      // A read has no title to be too long and no ceiling to hit, so anything
      // unrecognised here is simply "the list did not load".
      return {
        data: null,
        error:
          failure.code === 'UNKNOWN'
            ? errorFrom('UNKNOWN', 'errors.event.loadFailed', error)
            : failure,
      };
    }

    // A row whose type this build does not know is dropped rather than guessed
    // at — it would otherwise be a countdown with no icon and no label.
    return ok(data.flatMap((row) => toFamilyEvent(row) ?? []));
  });
}

export type NewEventInput = {
  familyId: string;
  title: string;
  /** `YYYY-MM-DD`. The column is a `date`, so anything else is refused. */
  eventDate: string;
  eventType: FamilyEventType;
  isAnnual: boolean;
};

export async function createEvent(input: NewEventInput): Promise<EventResult<FamilyEvent>> {
  return guarded(async () => {
    const { data: auth } = await supabase.auth.getUser();

    if (!auth.user) return fail('NOT_AUTHENTICATED', 'errors.notAuthenticated');

    const { data, error } = await supabase
      .from('family_events')
      .insert({
        family_id: input.familyId,
        title: input.title.trim(),
        event_date: input.eventDate,
        event_type: input.eventType,
        is_annual: input.isAnnual,
        created_by: auth.user.id,
      })
      .select()
      .single();

    if (error) return { data: null, error: toServiceError(error) };

    const event = toFamilyEvent(data);

    if (!event) return fail('UNKNOWN', 'errors.event.saveFailed');

    return ok(event);
  });
}

/**
 * What editing an event may change.
 *
 * Not the family and not the author: both are pinned by the RLS policy and by
 * `family_events_check_family`, so offering either would be offering a write
 * that cannot land.
 */
export type EventPatch = {
  title?: string;
  eventDate?: string;
  eventType?: FamilyEventType;
  isAnnual?: boolean;
};

export async function updateEvent(
  eventId: string,
  patch: EventPatch,
): Promise<EventResult<FamilyEvent>> {
  return guarded(async () => {
    const { data, error } = await supabase
      .from('family_events')
      .update({
        ...(patch.title !== undefined ? { title: patch.title.trim() } : {}),
        ...(patch.eventDate !== undefined ? { event_date: patch.eventDate } : {}),
        ...(patch.eventType !== undefined ? { event_type: patch.eventType } : {}),
        ...(patch.isAnnual !== undefined ? { is_annual: patch.isAnnual } : {}),
      })
      .eq('id', eventId)
      .select()
      .maybeSingle();

    if (error) return { data: null, error: toServiceError(error) };

    // RLS scopes the update to the author's own rows, so "no row came back"
    // means somebody else's date — or one already deleted. Either way this is a
    // refusal, and reporting it as success would leave the sheet claiming a
    // write that never happened.
    if (!data) return fail('NOT_FOUND', 'errors.event.notFound');

    const event = toFamilyEvent(data);

    if (!event) return fail('UNKNOWN', 'errors.event.saveFailed');

    return ok(event);
  });
}

/**
 * Deletes an event. The row goes rather than being flagged: there is no
 * "hidden" column, and a date nobody can see is not on the calendar — the same
 * reasoning that makes `clearOwnLocation` a delete.
 */
export async function deleteEvent(eventId: string): Promise<EventResult<null>> {
  return guarded(async () => {
    const { error } = await supabase.from('family_events').delete().eq('id', eventId);

    if (error) return { data: null, error: toServiceError(error) };

    return ok(null);
  });
}
