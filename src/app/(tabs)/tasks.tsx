import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { TaskCard } from '@/components/tasks/task-card';
import { TaskComposer } from '@/components/tasks/task-composer';
import { EmptyState, PressableScale, Screen, Section, Text } from '@/components/ui';
import type { FamilyTask, TaskStatus } from '@/data/types';
import { useAuth } from '@/hooks/useAuth';
import { useFamily } from '@/hooks/useFamily';
import { useIsMounted } from '@/hooks/use-safe-back';
import { useTabBarMetrics } from '@/hooks/use-tab-bar';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/hooks/use-translation';
import { Radius, Shadow, Spacing } from '@/theme';

type Filter = 'all' | 'mine';

/**
 * Every task the family has, however it was made.
 *
 * The "+" here opens the same `TaskComposer` Chat's does — one form, so a task
 * made from this tab carries an assignee and a deadline just like one made from
 * a conversation, and both announce themselves in the chat.
 */
export default function TasksScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { user, profile } = useAuth();
  const { tasks, members, getMember, isLoading, isRefreshing, refresh, setTaskStatus, createTask } =
    useFamily();
  const { clearance } = useTabBarMetrics();
  const isMounted = useIsMounted();

  // Read from the profile, not from `family`, which is also null while a real
  // family is loading. A task belongs to a family, so without one there is
  // nothing to add it to — the button says so rather than opening a form that
  // the insert policy would refuse.
  const hasFamily = !!profile?.family_id;

  const [filter, setFilter] = useState<Filter>('all');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isComposing, setIsComposing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { pending, completed } = useMemo(() => {
    const visible = filter === 'mine' ? tasks.filter((task) => task.assigneeId === user?.id) : tasks;

    // 'expired' is a terminal state the retention sweep sets; it belongs with
    // the finished work rather than in the list someone is meant to act on.
    const isFinished = (task: FamilyTask) =>
      task.status === 'completed' || task.status === 'expired';

    return {
      pending: visible.filter((task) => !isFinished(task)),
      completed: visible.filter(isFinished),
    };
  }, [filter, tasks, user?.id]);

  /**
   * Which status a press means is `TaskStatusActions`' business — it owns the
   * toggle rule and hands the resolved value down. This is only the write.
   */
  async function updateStatus(task: FamilyTask, status: TaskStatus) {
    setBusyId(task.id);
    setError(null);

    const failure = await setTaskStatus(task.id, status);

    if (!isMounted()) return;

    if (failure) setError(failure);
    setBusyId(null);
  }

  return (
    <View style={styles.flex}>
      <Screen
        scroll
        onRefresh={() => void refresh()}
        refreshing={isRefreshing}
        contentContainerStyle={{ paddingBottom: clearance }}>
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text variant="title">{t('tasks.title')}</Text>
            <Text variant="caption" color="textSecondary">
              {t('tasks.counts', { open: pending.length, completed: completed.length })}
            </Text>
          </View>
        </View>

        <View style={styles.filters}>
          {(['all', 'mine'] as const).map((option) => {
            const active = filter === option;
            return (
              <PressableScale
                key={option}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                onPress={() => setFilter(option)}
                // Moving between filters is picking within a set, so it gets
                // the selection tick rather than an impact.
                feedback="select"
                style={[
                  styles.filterChip,
                  {
                    backgroundColor: active ? colors.primary : colors.surface,
                    borderColor: active ? colors.primary : colors.border,
                  },
                ]}>
                <Text variant="captionStrong" color={active ? 'onPrimary' : 'textSecondary'}>
                  {option === 'all' ? t('tasks.filterAll') : t('tasks.filterMine')}
                </Text>
              </PressableScale>
            );
          })}
        </View>

        {error ? (
          <Text variant="caption" color="danger" style={styles.error}>
            {error}
          </Text>
        ) : null}

        <Section title={t('tasks.sectionPending')}>
          {isLoading ? (
            <EmptyState icon="list-outline" title={t('tasks.loading')} loading />
          ) : pending.length > 0 ? (
            <View style={styles.list}>
              {pending.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  assignee={getMember(task.assigneeId)}
                  currentUserId={user?.id}
                  busy={busyId === task.id}
                  onSetStatus={(status) => void updateStatus(task, status)}
                />
              ))}
            </View>
          ) : (
            <EmptyState
              icon="checkmark-done-circle-outline"
              title={filter === 'mine' ? t('tasks.emptyMine') : t('tasks.emptyAll')}
              description={
                filter === 'mine'
                  ? t('tasks.emptyMineBody')
                  : hasFamily
                    ? t('tasks.emptyAllBody')
                    : t('tasks.emptyNoFamilyBody')
              }
            />
          )}
        </Section>

        <Section title={t('tasks.sectionCompleted')}>
          {isLoading ? (
            <EmptyState icon="checkmark-done-outline" title={t('common.loading')} loading />
          ) : completed.length > 0 ? (
            <View style={styles.list}>
              {completed.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  assignee={getMember(task.assigneeId)}
                  currentUserId={user?.id}
                  busy={busyId === task.id}
                  onSetStatus={(status) => void updateStatus(task, status)}
                />
              ))}
            </View>
          ) : (
            <EmptyState icon="checkmark-done-outline" title={t('tasks.noCompleted')} />
          )}
        </Section>
      </Screen>

      {/* Not rendered at all without a family: a dimmed circle floating over an
          empty list explains nothing, and the empty state above already says
          what to do about it. */}
      {hasFamily ? (
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={t('tasks.addA11y')}
          onPress={() => setIsComposing(true)}
          feedback="press"
          // Sits above the floating tab bar rather than behind it.
          style={[styles.fab, { backgroundColor: colors.primary, bottom: clearance }]}>
          <Ionicons name="add" size={26} color={colors.onPrimary} />
        </PressableScale>
      ) : null}

      <TaskComposer
        visible={isComposing}
        onClose={() => setIsComposing(false)}
        members={members}
        currentUserId={user?.id}
        onCreate={createTask}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingTop: Spacing.md },
  headerText: { flex: 1, gap: 2 },
  filters: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.lg },
  filterChip: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  error: { marginTop: Spacing.md },
  list: { gap: Spacing.md },
  fab: {
    position: 'absolute',
    right: Spacing.lg,
    width: 56,
    height: 56,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadow.floating,
  },
});
