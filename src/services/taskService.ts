/**
 * Family tasks.
 *
 * The 20-active-task ceiling and the expiry sweep are triggers, not client
 * rules — a full list surfaces here as the database's own message. `expires_at`
 * is the only deadline a task carries; `duration_type` is what the user picks
 * and the two are kept in step by `tasks_fill_expiry`.
 */

import type { PostgrestError } from '@supabase/supabase-js';

import type { Database } from '@/data/database.types';
import type { FamilyTask, TaskDuration, TaskStatus } from '@/data/types';
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

type TaskRow = Database['public']['Tables']['tasks']['Row'];

export type TaskErrorCode = CommonErrorCode | 'TOO_MANY_ACTIVE' | 'INVALID_TITLE' | 'NOT_A_MEMBER';

export type TaskServiceError = ServiceError<TaskErrorCode>;
export type TaskResult<T> = ServiceResult<T, TaskErrorCode>;

/** Mirrors the `tasks_title_length` check constraint. */
export const MAX_TASK_TITLE_LENGTH = 200;

const STATUSES: readonly TaskStatus[] = ['pending', 'in_progress', 'completed', 'expired'];
const DURATIONS: readonly TaskDuration[] = ['1_day', '1_week', '1_month'];

/** Matches `private.fill_task_expiry()`, which the client cannot call directly. */
const DURATION_MS: Record<TaskDuration, number> = {
  '1_day': 24 * 60 * 60 * 1000,
  '1_week': 7 * 24 * 60 * 60 * 1000,
  '1_month': 30 * 24 * 60 * 60 * 1000,
};

/**
 * The deadline a given duration resolves to.
 *
 * Exported so the composer can show the user the actual date they are choosing:
 * `duration_type` is the only vocabulary the check constraint allows, but
 * "1 week" means a moment, and naming it is the difference between picking a
 * duration and picking a due date.
 */
export function expiryFor(durationType: TaskDuration, now = Date.now()): Date {
  return new Date(now + DURATION_MS[durationType]);
}

function toServiceError(error: PostgrestError): TaskServiceError {
  const message = error.message ?? '';
  const cause = error;

  if (error.code === 'P0001' && /task/i.test(message)) {
    // "This family already has 20 active tasks" — the database wrote it for
    // humans, so it passes through as text and stays English. Translating it
    // would mean a column of message codes on the server side.
    return errorFrom('TOO_MANY_ACTIVE', { text: message }, cause);
  }
  if (/tasks_title_length/.test(message)) {
    return errorFrom(
      'INVALID_TITLE',
      { key: 'errors.task.titleTooLong', vars: { max: MAX_TASK_TITLE_LENGTH } },
      cause,
    );
  }
  if (error.code === '42501' || /row-level security/i.test(message)) {
    return errorFrom('NOT_A_MEMBER', 'errors.task.notMember', cause);
  }
  if (error.code === '28000') {
    return errorFrom('NOT_AUTHENTICATED', 'errors.notAuthenticated', cause);
  }

  return errorFrom('UNKNOWN', 'errors.unknown', cause);
}

export function toFamilyTask(row: TaskRow): FamilyTask {
  return {
    id: row.id,
    title: row.title,
    status: STATUSES.find((candidate) => candidate === row.status) ?? 'pending',
    assigneeId: row.assigned_to,
    createdById: row.created_by,
    handledById: row.handled_by,
    durationType: DURATIONS.find((candidate) => candidate === row.duration_type) ?? '1_day',
    expiresAt: row.expires_at,
    sourceMessageId: row.source_message_id,
    createdAt: row.created_at,
  };
}

/** Soonest deadline first — that is the order the Pending list wants. */
export async function listTasks(familyId: string): Promise<TaskResult<FamilyTask[]>> {
  return guarded(async () => {
    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .eq('family_id', familyId)
      .order('expires_at', { ascending: true });

    if (error) return { data: null, error: toServiceError(error) };

    return ok(data.map(toFamilyTask));
  });
}

/**
 * Moves a task between states and records who did it.
 *
 * `handled_by` is what the schema means by "last member who moved the task", so
 * it is set here rather than left to the caller.
 */
export async function setTaskStatus(taskId: string, status: TaskStatus): Promise<TaskResult<FamilyTask>> {
  return guarded(async () => {
    const { data: auth } = await supabase.auth.getUser();

    if (!auth.user) return fail('NOT_AUTHENTICATED', 'errors.notAuthenticated');

    const { data, error } = await supabase
      .from('tasks')
      .update({ status, handled_by: auth.user.id })
      .eq('id', taskId)
      .select()
      .single();

    if (error) return { data: null, error: toServiceError(error) };

    return ok(toFamilyTask(data));
  });
}

export type CreateTaskInput = {
  familyId: string;
  title: string;
  durationType?: TaskDuration;
  /** Omitted leaves the task in the pool for anyone to pick up. */
  assigneeId?: string | null;
};

/**
 * Points a task at the chat message that announced it.
 *
 * Separate from `createTask` because the two rows reference each other in one
 * direction only: the message has to exist before the task can name it, and the
 * task has to exist before it is worth announcing. Creating the task first and
 * linking afterwards means a failure anywhere in the chain still leaves a real
 * task on the Tasks page rather than an orphaned message in the chat.
 *
 * `tasks: family updates` covers this — any member may update any task in their
 * family, so no ownership check is needed beyond the one RLS already applies.
 */
export async function linkTaskToMessage(
  taskId: string,
  messageId: string,
): Promise<TaskResult<FamilyTask>> {
  return guarded(async () => {
    const { data, error } = await supabase
      .from('tasks')
      .update({ source_message_id: messageId })
      .eq('id', taskId)
      .select()
      .single();

    if (error) return { data: null, error: toServiceError(error) };

    return ok(toFamilyTask(data));
  });
}

export async function createTask(input: CreateTaskInput): Promise<TaskResult<FamilyTask>> {
  const title = input.title.trim();

  if (!title || title.length > MAX_TASK_TITLE_LENGTH) {
    return fail('INVALID_TITLE', {
      key: 'errors.task.titleTooLong',
      vars: { max: MAX_TASK_TITLE_LENGTH },
    });
  }

  return guarded(async () => {
    const { data: auth } = await supabase.auth.getUser();

    if (!auth.user) return fail('NOT_AUTHENTICATED', 'errors.notAuthenticated');

    const durationType = input.durationType ?? '1_day';

    const { data, error } = await supabase
      .from('tasks')
      .insert({
        family_id: input.familyId,
        created_by: auth.user.id,
        assigned_to: input.assigneeId ?? null,
        title,
        duration_type: durationType,
        // `tasks_fill_expiry` would derive this, but the column is NOT NULL and
        // therefore required by the generated Insert type. Same arithmetic.
        expires_at: expiryFor(durationType).toISOString(),
      })
      .select()
      .single();

    if (error) return { data: null, error: toServiceError(error) };

    return ok(toFamilyTask(data));
  });
}
