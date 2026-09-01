import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { SwipeToComplete } from '@/components/tasks/swipe-to-complete';
import { canActOnTask, TaskStatusActions } from '@/components/tasks/task-status-actions';
import { Avatar } from '@/components/ui/avatar';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { dueLabel } from '@/data/format';
import type { FamilyMember, FamilyTask, TaskStatus } from '@/data/types';
import { useHaptics } from '@/hooks/use-haptics';
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

type TaskCardProps = {
  task: FamilyTask;
  /** Resolved by the caller; undefined for an unclaimed pool task. */
  assignee?: FamilyMember;
  /** The signed-in user — decides whether the actions below are live. */
  currentUserId?: string | null;
  /** Writes the new status through to `tasks`. */
  onSetStatus?: (status: TaskStatus) => void;
  /** Blocks the actions while the update is in flight. */
  busy?: boolean;
};

/**
 * One task, as a card.
 *
 * The single checkbox is gone. A task has three states worth showing and a
 * checkbox could only ever say two of them, so the card now carries the pair of
 * buttons in `TaskStatusActions` — which is also where the rule about *who* may
 * press them lives, shared with the copy of this card that appears in chat.
 *
 * Swiping survives as the shortcut it always was, and answers to the same rule:
 * it is offered only on an open task this viewer is allowed to move, so a pull
 * can never complete something that belongs to somebody else.
 */
export function TaskCard({
  task,
  assignee,
  currentUserId,
  onSetStatus,
  busy = false,
}: TaskCardProps) {
  const { colors } = useTheme();
  const i18n = useTranslation();
  const { t } = i18n;
  const haptic = useHaptics();
  const isDone = task.status === 'completed';
  const isFinished = isDone || task.status === 'expired';
  const status = STATUS_BADGE[task.status];
  const canAct = canActOnTask(task, currentUserId);

  /**
   * The swipe's own write. It fires the achievement pattern here rather than in
   * `SwipeToComplete`, for the same reason the buttons fire theirs in
   * `TaskStatusActions`: the feedback belongs to the write, and one owner per
   * write is what stops a path buzzing twice.
   */
  const completeBySwipe = () => {
    haptic('success');
    onSetStatus?.('completed');
  };

  return (
    <SwipeToComplete
      enabled={!!onSetStatus && canAct && !isFinished && !busy}
      onComplete={completeBySwipe}>
      <Card style={styles.card}>
        <View style={styles.headline}>
          <View style={styles.body}>
            <Text
              variant="bodyStrong"
              color={isDone ? 'textTertiary' : 'text'}
              style={isDone ? styles.struck : undefined}>
              {task.title}
            </Text>

            <View style={styles.meta}>
              <Badge label={t(status.key)} tone={status.tone} />

              {/* `expires_at` is the only deadline a task carries. */}
              {!isFinished ? (
                <View style={styles.due}>
                  <Ionicons name="time-outline" size={12} color={colors.textTertiary} />
                  <Text variant="label" color="textTertiary">
                    {dueLabel(i18n, task.expiresAt)}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>

          {assignee ? (
            <Avatar
              initials={assignee.initials}
              colorIndex={assignee.colorIndex}
              avatar={assignee.avatar}
              size="sm"
            />
          ) : (
            <View style={[styles.unassigned, { borderColor: colors.border }]}>
              <Ionicons name="person-add-outline" size={14} color={colors.textTertiary} />
            </View>
          )}
        </View>

        {onSetStatus ? (
          <TaskStatusActions
            task={task}
            currentUserId={currentUserId}
            assignee={assignee}
            onSetStatus={onSetStatus}
            busy={busy}
          />
        ) : null}
      </Card>
    </SwipeToComplete>
  );
}

const styles = StyleSheet.create({
  card: { gap: Spacing.md },
  headline: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  body: { flex: 1, gap: Spacing.xs },
  struck: { textDecorationLine: 'line-through' },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginTop: 2,
  },
  due: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  // Stands in for the avatar so an unclaimed task keeps the row's alignment.
  unassigned: {
    width: 32,
    height: 32,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
