/**
 * The Home "Recent activity" feed.
 *
 * There is no activity table, and inventing one client-side would mean guessing
 * timestamps. So the feed is folded together from rows that already carry a
 * real `created_at` — messages sent and tasks created — and nothing else. Task
 * completion is not represented: `tasks` records `handled_by` but never when.
 */

import { memberName } from '@/data/format';
import type { ActivityEvent, ChatMessage, FamilyMember, FamilyTask } from '@/data/types';
import type { Translator } from '@/i18n';

/** Long enough to identify the message, short enough for one line. */
const PREVIEW_LENGTH = 60;

function preview(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();

  return collapsed.length > PREVIEW_LENGTH
    ? `${collapsed.slice(0, PREVIEW_LENGTH - 1)}…`
    : collapsed;
}

export type DeriveActivityInput = {
  /** Passed in rather than read from ambient state — see `data/format.ts`. */
  i18n: Translator;
  messages: ChatMessage[];
  tasks: FamilyTask[];
  members: FamilyMember[];
  limit?: number;
};

/** Newest first, capped — the Home card shows a handful, not a history. */
export function deriveActivity({
  i18n,
  messages,
  tasks,
  members,
  limit = 5,
}: DeriveActivityInput): ActivityEvent[] {
  const nameOf = (id: string) => {
    const member = members.find((candidate) => candidate.id === id);

    return member ? memberName(i18n, member) : i18n.t('common.someone');
  };

  const fromMessages: ActivityEvent[] = messages
    // A `system` message is the app announcing a task in the chat, and that
    // task already contributes its own event below. Including it would list the
    // same thing twice — and the type test further down would report it as a
    // photo, which it is not.
    .filter((message) => message.type !== 'system')
    .map((message) => ({
      id: `message-${message.id}`,
      kind: 'message',
      text:
        message.type === 'text' && message.content
          ? i18n.t('activity.message', {
              name: nameOf(message.senderId),
              preview: preview(message.content),
            })
          : i18n.t('activity.photo', { name: nameOf(message.senderId) }),
      memberId: message.senderId,
      at: message.createdAt,
    }));

  const fromTasks: ActivityEvent[] = tasks.map((task) => ({
    id: `task-${task.id}`,
    kind: 'task',
    text: i18n.t('activity.task', {
      name: nameOf(task.createdById),
      title: preview(task.title),
    }),
    memberId: task.createdById,
    at: task.createdAt,
  }));

  return [...fromMessages, ...fromTasks]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, limit);
}
