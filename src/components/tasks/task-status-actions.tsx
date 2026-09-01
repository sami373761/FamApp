/**
 * The two things you can do to an existing task: start it, or finish it.
 *
 * One component rather than a control per surface, because a task is the same
 * task on the Tasks tab and in the chat stream — the Tasks card and
 * `TaskMessageCard` both render this, so the rules below cannot drift between
 * them. It replaces the single checkbox both used to carry, which could only
 * say done or not done and had no way to show that somebody had picked
 * something up.
 *
 * **Who may press them is a UI rule, not a security boundary.** The database's
 * `tasks: family updates` policy is deliberately family-wide — its comment
 * reads "any member may claim, hand over or complete any task in their family"
 * — so a member who is not the assignee is *stopped here and nowhere else*.
 * Making it a real constraint means narrowing that policy in a migration; until
 * then this is an affordance that keeps people out of each other's work, and
 * should not be described as more than that.
 */

import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { PressableScale } from '@/components/ui/pressable-scale';
import { Text } from '@/components/ui/text';
import { memberName } from '@/data/format';
import type { FamilyMember, FamilyTask, TaskStatus } from '@/data/types';
import { useHaptics, type HapticFeedback } from '@/hooks/use-haptics';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/hooks/use-translation';
import { Radius, Spacing } from '@/theme';

/**
 * Whether this viewer is allowed to move the task.
 *
 * An unassigned task is the pool: anyone in the family may pick it up. Once it
 * names somebody, it is theirs — so the buttons go quiet for everyone else
 * rather than disappearing, which would leave no explanation for why the card
 * is inert.
 */
export function canActOnTask(task: FamilyTask, currentUserId?: string | null): boolean {
  return task.assigneeId === null || task.assigneeId === currentUserId;
}

type TaskStatusActionsProps = {
  task: FamilyTask;
  /** The signed-in user, compared against `assigneeId`. */
  currentUserId?: string | null;
  /** Resolved by the caller — names whoever the task is locked to. */
  assignee?: FamilyMember;
  /** Writes the new status through to `tasks`. */
  onSetStatus: (status: TaskStatus) => void;
  /** Blocks both buttons while an update is in flight. */
  busy?: boolean;
};

export function TaskStatusActions({
  task,
  currentUserId,
  assignee,
  onSetStatus,
  busy = false,
}: TaskStatusActionsProps) {
  const { colors } = useTheme();
  const i18n = useTranslation();
  const { t } = i18n;

  // 'expired' is the retention sweep's verdict rather than a state anyone chose,
  // so it is not offered back — the badge says what happened and that is all.
  if (task.status === 'expired') return null;

  const canAct = canActOnTask(task, currentUserId);

  return (
    <View style={styles.wrapper}>
      <View style={styles.row}>
        <StatusButton
          icon="play-circle-outline"
          activeIcon="play-circle"
          label={t('taskStatus.inProgress')}
          tone="info"
          active={task.status === 'in_progress'}
          disabled={!canAct}
          busy={busy}
          title={task.title}
          // Pressing the state a task is already in clears it back to the
          // untouched one, so the pair is a toggle rather than a one-way trip.
          next={task.status === 'in_progress' ? 'pending' : 'in_progress'}
          onSetStatus={onSetStatus}
        />

        <StatusButton
          icon="checkmark-circle-outline"
          activeIcon="checkmark-circle"
          label={t('taskStatus.completed')}
          tone="success"
          active={task.status === 'completed'}
          disabled={!canAct}
          busy={busy}
          title={task.title}
          next={task.status === 'completed' ? 'pending' : 'completed'}
          onSetStatus={onSetStatus}
        />
      </View>

      {/* Says why the buttons above will not move, rather than leaving a dead
          control to be read as a bug. */}
      {!canAct && assignee ? (
        <View style={styles.hint}>
          <Ionicons name="lock-closed-outline" size={12} color={colors.textTertiary} />
          <Text variant="label" color="textTertiary" style={styles.flex}>
            {t('task.lockedHint', { name: memberName(i18n, assignee) })}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/**
 * The tone each button wears when it is the task's current state. Both borrow
 * the badge's own pairing, so the button someone pressed and the badge that
 * reports the result are the same colour.
 */
type ActionTone = 'info' | 'success';

type StatusButtonProps = {
  icon: keyof typeof Ionicons.glyphMap;
  /** Its filled twin, worn while this is the task's current state. */
  activeIcon: keyof typeof Ionicons.glyphMap;
  label: string;
  tone: ActionTone;
  active: boolean;
  disabled: boolean;
  busy: boolean;
  title: string;
  next: TaskStatus;
  onSetStatus: (status: TaskStatus) => void;
};

function StatusButton({
  icon,
  activeIcon,
  label,
  tone,
  active,
  disabled,
  busy,
  title,
  next,
  onSetStatus,
}: StatusButtonProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const haptic = useHaptics();

  const solid = tone === 'success' ? colors.success : colors.info;
  const soft = tone === 'success' ? colors.successSoft : colors.infoSoft;

  /**
   * The feedback follows what the press *means*, not which button it was:
   * finishing something is the one press worth an achievement, starting is a
   * move within a set, and either kind of undo is a plain correction.
   */
  const feedback: HapticFeedback = active ? 'tap' : next === 'completed' ? 'success' : 'select';

  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityState={{ selected: active, disabled: disabled || busy }}
      accessibilityLabel={t('task.setStatusA11y', { title, status: label })}
      disabled={disabled || busy}
      onPress={() => {
        haptic(feedback);
        onSetStatus(next);
      }}
      feedback="none"
      style={[
        styles.button,
        {
          backgroundColor: active ? soft : colors.surface,
          borderColor: active ? solid : colors.border,
        },
        (disabled || busy) && styles.dimmed,
      ]}>
      {busy && active ? (
        <ActivityIndicator size="small" color={solid} />
      ) : (
        <Ionicons
          name={active ? activeIcon : icon}
          size={16}
          color={active ? solid : colors.textTertiary}
        />
      )}

      <Text variant="captionStrong" color={active ? 'text' : 'textSecondary'} numberOfLines={1}>
        {label}
      </Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  wrapper: { gap: Spacing.sm },
  row: { flexDirection: 'row', gap: Spacing.sm },
  button: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    // Tall enough to hit without aiming, on a card that holds two of them.
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  dimmed: { opacity: 0.45 },
  hint: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
});
