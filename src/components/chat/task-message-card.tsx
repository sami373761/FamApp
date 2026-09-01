/**
 * A task rendered inline in the message stream.
 *
 * The chat row it replaces is a real `messages` row of type `system`; the task
 * it shows is the `tasks` row whose `source_message_id` points back at it. So
 * this is not a special kind of message — it is the ordinary announcement,
 * drawn as the thing it announces once that thing can be found.
 *
 * Full-width rather than bubble-shaped: it is the app speaking, not a person,
 * and a card that took a side would read as somebody's line. The sender's
 * avatar still sits beside it, because a real member did create the task.
 *
 * Interactive for the same reason the Tasks tab is — moving it here writes
 * through `setTaskStatus` and every other surface reading `FamilyContext`
 * updates with it. It carries the same `TaskStatusActions` the Tasks card does,
 * so "in progress" and "done" mean the same press and obey the same rule about
 * who may make it, wherever the task is being looked at.
 */

import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { TaskStatusActions } from '@/components/tasks/task-status-actions';
import { Avatar } from '@/components/ui/avatar';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Text } from '@/components/ui/text';
import { clockTime, dueLabel, memberName } from '@/data/format';
import type { FamilyMember, FamilyTask, TaskStatus } from '@/data/types';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/hooks/use-translation';
import type { TranslationKey } from '@/i18n';
import { Radius, Spacing } from '@/theme';

/**
 * Tone per status; the label is a catalog key rather than a string, so this
 * table stays a constant instead of being rebuilt on every render.
 */
const STATUS_BADGE: Record<TaskStatus, { key: TranslationKey; tone: BadgeTone }> = {
  pending: { key: 'taskStatus.pending', tone: 'warning' },
  in_progress: { key: 'taskStatus.inProgress', tone: 'info' },
  completed: { key: 'taskStatus.completed', tone: 'success' },
  expired: { key: 'taskStatus.expired', tone: 'danger' },
};

type TaskMessageCardProps = {
  task: FamilyTask;
  /** When the announcement was posted — the card's own timestamp. */
  createdAt: string;
  /** Who created the task; undefined for a member who has since left. */
  author?: FamilyMember;
  /** Resolved by the caller; undefined for an unclaimed pool task. */
  assignee?: FamilyMember;
  /** True when the signed-in user created it. */
  isOwn: boolean;
  /** The signed-in user — decides whether the actions below are live. */
  currentUserId?: string | null;
  /** Writes the new status through to `tasks`. */
  onSetStatus: (status: TaskStatus) => void;
  busy?: boolean;
};

export function TaskMessageCard({
  task,
  createdAt,
  author,
  assignee,
  isOwn,
  currentUserId,
  onSetStatus,
  busy = false,
}: TaskMessageCardProps) {
  const { colors } = useTheme();
  const i18n = useTranslation();
  const { t } = i18n;
  const isDone = task.status === 'completed';
  // Expiry is the retention sweep's verdict, not something to undo from a chat
  // bubble. `TaskStatusActions` withholds itself for that status, so the card
  // below simply ends after the badge.
  const isExpired = task.status === 'expired';
  const status = STATUS_BADGE[task.status];

  return (
    <View style={styles.row}>
      <View style={styles.avatarSlot}>
        {author ? (
          <Avatar
            initials={author.initials}
            colorIndex={author.colorIndex}
            avatar={author.avatar}
            size="sm"
          />
        ) : null}
      </View>

      <View
        style={[
          styles.card,
          {
            backgroundColor: colors.surface,
            // The accent edge is what separates a task from a message at a
            // glance on a canvas where cards cannot separate themselves by fill.
            borderColor: isDone ? colors.border : colors.primary,
          },
        ]}>
        <View style={styles.header}>
          <View style={[styles.icon, { backgroundColor: colors.primarySoft }]}>
            <Ionicons name="checkbox-outline" size={14} color={colors.primary} />
          </View>

          <Text variant="label" color="textSecondary" style={styles.flex}>
            {(isOwn
              ? t('taskMessage.youAdded')
              : t('taskMessage.someoneAdded', {
                  name: author ? memberName(i18n, author) : t('common.someone'),
                })
            ).toUpperCase()}
          </Text>

          <Text variant="label" color="textTertiary">
            {clockTime(i18n, createdAt)}
          </Text>
        </View>

        <Text
          variant="bodyStrong"
          color={isDone ? 'textTertiary' : 'text'}
          style={isDone ? styles.struck : undefined}>
          {task.title}
        </Text>

        <View style={styles.meta}>
          <Badge label={t(status.key)} tone={status.tone} />

          {!isDone && !isExpired ? (
            <View style={styles.metaItem}>
              <Ionicons name="time-outline" size={12} color={colors.textTertiary} />
              <Text variant="label" color="textTertiary">
                {dueLabel(i18n, task.expiresAt)}
              </Text>
            </View>
          ) : null}

          <View style={styles.metaItem}>
            {assignee ? (
              <>
                <Avatar
                  initials={assignee.initials}
                  colorIndex={assignee.colorIndex}
                  avatar={assignee.avatar}
                  size="sm"
                />
                <Text variant="label" color="textTertiary">
                  {memberName(i18n, assignee)}
                </Text>
              </>
            ) : (
              <>
                <Ionicons name="person-add-outline" size={12} color={colors.textTertiary} />
                <Text variant="label" color="textTertiary">
                  {t('common.anyone')}
                </Text>
              </>
            )}
          </View>
        </View>

        <TaskStatusActions
          task={task}
          currentUserId={currentUserId}
          assignee={assignee}
          onSetStatus={onSetStatus}
          busy={busy}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.sm, marginBottom: Spacing.sm },
  // Matches `MessageBubble`, so a card and a bubble line up down the column.
  avatarSlot: { width: 32 },
  card: {
    flex: 1,
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  icon: {
    width: 22,
    height: 22,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  struck: { textDecorationLine: 'line-through' },
  meta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Spacing.md },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
});
