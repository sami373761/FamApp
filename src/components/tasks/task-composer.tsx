/**
 * The one form that creates a task, opened from Chat's "+" menu and from the
 * Tasks tab's floating button.
 *
 * Shared rather than duplicated so the two entry points cannot drift: whatever
 * a task can carry, it carries wherever it was made. Every control here maps to
 * a column — there is no description field because `tasks` has no description
 * column, and inventing one would be the same mistake as inventing a fixture.
 * The optional note is honest about being a chat message, because that is what
 * it is stored as.
 *
 * **The layout is a disclosure list, and that is the keyboard fix.** Every
 * control used to be on screen at once, which made the form taller than the
 * space left over once a keyboard took half the window — so the panel scrolled
 * under its own footer and a focused field could sit behind the keys. Here the
 * title is the only thing always open; assignee, due date and note collapse to
 * a single row each, showing the value they currently hold, and **only one may
 * be open at a time**. The form is therefore short by construction, and every
 * section that contains an input sits near the top of the panel when it is the
 * one expanded.
 *
 * Keyboard *avoidance* is deliberately not here. Both entry points render this
 * inside `Sheet`, which owns the one `KeyboardAvoidingView`; a second one
 * nested inside it would apply the inset twice and lift the panel clear off the
 * keyboard it was avoiding.
 *
 * Split in two: `TaskComposerForm` is the content, `TaskComposer` is that
 * content in a `Sheet`. Chat needs the bare form because its "+" menu and this
 * form share a single sheet — presenting and dismissing two native modals in
 * one frame is unreliable on iOS, so the sheet changes what it holds instead of
 * handing off to another one.
 */

import { Ionicons } from '@expo/vector-icons';
import { useRef, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import {
  Avatar,
  Button,
  PressableScale,
  Segmented,
  Sheet,
  Text,
  TextField,
  type SegmentedOption,
} from '@/components/ui';
import type { NewTask } from '@/context/FamilyContext';
import { memberName } from '@/data/format';
import type { FamilyMember, TaskDuration } from '@/data/types';
import { useIsMounted } from '@/hooks/use-safe-back';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/hooks/use-translation';
import { MAX_MESSAGE_LENGTH } from '@/services/chatService';
import { expiryFor, MAX_TASK_TITLE_LENGTH } from '@/services/taskService';
import { Radius, Spacing } from '@/theme';

/**
 * How much of the window the scrolling half of the form may take, and the floor
 * it may not shrink past. Derived rather than fixed: a constant tall enough for
 * a large phone pushes the action row off a small one the moment the keyboard
 * opens.
 */
const SCROLL_HEIGHT_RATIO = 0.5;
const MIN_SCROLL_HEIGHT = 200;

/** Keeps the pool glyph on the same 32pt circle the member avatars use. */
const WELL_SIZE = 32;

/** Which disclosure row is open; at most one, which is what bounds the height. */
type OpenSection = 'none' | 'assignee' | 'due' | 'note';

type TaskComposerFormProps = {
  /** The roster to assign from. Empty for a solo user, which is a valid state. */
  members: FamilyMember[];
  /**
   * What the title field starts with — Chat's "create task from message" hands
   * the message's own text down here.
   *
   * It is a *seed*, not a controlled value: the form owns the draft from the
   * first keystroke, so this is read once, when the caller mounts the form.
   * Both entry points already unmount it on close, which is what makes the next
   * open start from whatever is passed then rather than from what was typed
   * last time. A caller passing something longer than a title may be must trim
   * it — `MAX_TASK_TITLE_LENGTH` is exported for exactly that, and `maxLength`
   * on the field below only bounds what is typed into it.
   */
  initialTitle?: string;
  /** Used to label the assignee chip for the person filling the form in. */
  currentUserId?: string | null;
  /** Resolves to an error message to show in place, or null once stored. */
  onCreate: (input: NewTask) => Promise<string | null>;
  /** Called on cancel and on success — the caller closes whatever holds this. */
  onClose: () => void;
};

/**
 * The form itself. Drafts live in local state, so the caller unmounting it is
 * what resets it — there is no effect keeping a "cleared" flag in step.
 */
export function TaskComposerForm({
  members,
  initialTitle = '',
  currentUserId,
  onCreate,
  onClose,
}: TaskComposerFormProps) {
  const { colors } = useTheme();
  const i18n = useTranslation();
  const { t } = i18n;
  const isMounted = useIsMounted();
  const { height: windowHeight } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);

  /**
   * The three values `tasks_duration_valid` allows, and therefore the whole due
   * date vocabulary. A free calendar would need a picker dependency the app
   * does not have and a column the schema does not offer.
   */
  const durationOptions: readonly SegmentedOption<TaskDuration>[] = [
    { value: '1_day', label: t('composer.durationDay') },
    { value: '1_week', label: t('composer.durationWeek') },
    { value: '1_month', label: t('composer.durationMonth') },
  ];

  const [title, setTitle] = useState(initialTitle);
  const [note, setNote] = useState('');
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [duration, setDuration] = useState<TaskDuration>('1_day');
  const [open, setOpen] = useState<OpenSection>('none');
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = title.trim();
  const canSubmit = trimmed.length > 0 && trimmed.length <= MAX_TASK_TITLE_LENGTH && !isCreating;

  const scrollMaxHeight = Math.max(MIN_SCROLL_HEIGHT, windowHeight * SCROLL_HEIGHT_RATIO);

  const assignee = members.find((member) => member.id === assigneeId);

  /**
   * What the collapsed rows say. The assignee summary names the current user
   * "Me", exactly as their chip does — a row and the control behind it
   * disagreeing about the same person is the sort of thing that reads as a bug.
   * An id with no member left in the roster falls back to the pool label rather
   * than to a blank, since that is what the insert would effectively mean.
   */
  const assigneeLabel = assignee
    ? assignee.id === currentUserId
      ? t('common.me')
      : memberName(i18n, assignee)
    : t('common.anyone');
  const durationLabel =
    durationOptions.find((option) => option.value === duration)?.label ?? duration;

  /**
   * Opening a section closes whichever one was open. The note is the lowest row
   * and the only one that opens an input below the fold, so opening it also
   * brings the panel's foot into view — the keyboard arrives a beat later and
   * the field is already where it needs to be.
   */
  function toggleSection(section: Exclude<OpenSection, 'none'>) {
    const next = open === section ? 'none' : section;

    setOpen(next);

    if (next === 'note') {
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    }
  }

  async function submit() {
    if (!canSubmit) return;

    setIsCreating(true);
    setError(null);

    const failure = await onCreate({
      title: trimmed,
      assigneeId,
      durationType: duration,
      note: note.trim() || null,
    });

    if (!isMounted()) return;

    setIsCreating(false);

    // The form survives a failure so nothing typed is lost — the same rule the
    // chat composer follows.
    if (failure) {
      setError(failure);
      return;
    }

    onClose();
  }

  return (
    <>
      <ScrollView
        ref={scrollRef}
        style={[styles.scroll, { maxHeight: scrollMaxHeight }]}
        showsVerticalScrollIndicator={false}
        // A tap on a disclosure row while a field has focus has to land on the
        // row, not be eaten dismissing the keyboard.
        keyboardShouldPersistTaps="handled"
        // Dragging the form away is the gesture that puts the keyboard down.
        keyboardDismissMode="on-drag"
        contentContainerStyle={styles.form}>
        {/* The one thing always open: a task is its title, and everything below
            has a working default. */}
        <TextField
          label={t('composer.taskLabel')}
          value={title}
          onChangeText={setTitle}
          placeholder={t('composer.taskPlaceholder')}
          autoCapitalize="words"
          maxLength={MAX_TASK_TITLE_LENGTH}
          returnKeyType="next"
          editable={!isCreating}
        />

        <View style={[styles.group, { borderColor: colors.border }]}>
          <DisclosureRow
            icon="people-outline"
            label={t('composer.assignLabel')}
            value={assigneeLabel}
            leading={
              assignee ? (
                <Avatar
                  initials={assignee.initials}
                  colorIndex={assignee.colorIndex}
                  avatar={assignee.avatar}
                  size="sm"
                />
              ) : undefined
            }
            expanded={open === 'assignee'}
            disabled={isCreating}
            onPress={() => toggleSection('assignee')}>
            <View style={styles.chips}>
              <AssigneeChip
                label={t('common.anyone')}
                selected={assigneeId === null}
                disabled={isCreating}
                onPress={() => setAssigneeId(null)}
              />

              {members.map((member) => (
                <AssigneeChip
                  key={member.id}
                  label={member.id === currentUserId ? t('common.me') : memberName(i18n, member)}
                  member={member}
                  selected={assigneeId === member.id}
                  disabled={isCreating}
                  onPress={() => setAssigneeId(member.id)}
                />
              ))}
            </View>

            <Text variant="caption" color="textTertiary">
              {assigneeId === null ? t('composer.assignPool') : t('composer.assignPerson')}
            </Text>
          </DisclosureRow>

          <DisclosureRow
            icon="time-outline"
            label={t('composer.dueLabel')}
            value={durationLabel}
            expanded={open === 'due'}
            disabled={isCreating}
            onPress={() => toggleSection('due')}>
            <Segmented
              label={t('composer.dueLabel')}
              options={durationOptions}
              value={duration}
              onChange={setDuration}
              disabled={isCreating}
            />

            {/* The stored deadline, so the choice reads as a date and not just a
                span. It is what `expires_at` will hold. */}
            <Text variant="caption" color="textTertiary">
              {t('composer.expires', {
                date: expiryFor(duration).toLocaleString(i18n.locale, {
                  day: 'numeric',
                  month: 'long',
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: false,
                }),
              })}
            </Text>
          </DisclosureRow>

          <DisclosureRow
            icon="chatbubble-outline"
            label={t('composer.noteLabel')}
            value={note.trim()}
            expanded={open === 'note'}
            disabled={isCreating}
            isLast
            onPress={() => toggleSection('note')}>
            <TextField
              label={t('composer.noteLabel')}
              value={note}
              onChangeText={setNote}
              placeholder={t('composer.notePlaceholder')}
              autoCapitalize="words"
              multiline
              maxLength={MAX_MESSAGE_LENGTH}
              editable={!isCreating}
            />

            {/* Says what the note actually becomes: a message of yours in the
                chat, because that is the row it is stored as. */}
            <Text variant="caption" color="textTertiary">
              {t('composer.noteHint')}
            </Text>
          </DisclosureRow>
        </View>

        {error ? (
          <View style={[styles.error, { backgroundColor: colors.dangerSoft }]}>
            <Ionicons name="alert-circle-outline" size={18} color={colors.danger} />
            <Text variant="caption" color="danger" style={styles.flex}>
              {error}
            </Text>
          </View>
        ) : null}
      </ScrollView>

      <View style={[styles.actions, { borderTopColor: colors.separator }]}>
        <Button
          label={t('common.cancel')}
          variant="secondary"
          size="md"
          disabled={isCreating}
          onPress={onClose}
          style={styles.flex}
        />
        <Button
          label={t('composer.submit')}
          size="md"
          loading={isCreating}
          disabled={!canSubmit}
          onPress={() => void submit()}
          style={styles.flex}
        />
      </View>
    </>
  );
}

type TaskComposerProps = TaskComposerFormProps & { visible: boolean };

/** The form in its own sheet — what the Tasks tab opens. */
export function TaskComposer({ visible, onClose, ...form }: TaskComposerProps) {
  const { t } = useTranslation();

  return (
    <Sheet
      visible={visible}
      title={t('composer.title')}
      description={t('composer.description')}
      onClose={onClose}>
      {/*
        Mounted only while open so closing the sheet clears the draft: the form
        holds its fields in local state and has no reset of its own.
      */}
      {visible ? <TaskComposerForm onClose={onClose} {...form} /> : null}
    </Sheet>
  );
}

type DisclosureRowProps = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  /** The setting's current answer, shown collapsed. Empty renders nothing. */
  value: string;
  /** Replaces the glyph well when the value has a face — the chosen assignee. */
  leading?: ReactNode;
  expanded: boolean;
  disabled: boolean;
  isLast?: boolean;
  onPress: () => void;
  children: ReactNode;
};

/**
 * One collapsed setting: what it is, what it currently says, and a chevron.
 *
 * The summary is the point — a form where every group is expanded makes the
 * reader do the summarising, and is the height that put a field behind the
 * keyboard. Collapsed, three rows say "Anyone · Tomorrow · no note" in the
 * space one of them used to take.
 */
function DisclosureRow({
  icon,
  label,
  value,
  leading,
  expanded,
  disabled,
  isLast = false,
  onPress,
  children,
}: DisclosureRowProps) {
  const { colors } = useTheme();

  return (
    <View style={isLast ? undefined : [styles.divided, { borderBottomColor: colors.separator }]}>
      <PressableScale
        accessibilityRole="button"
        accessibilityState={{ expanded, disabled }}
        accessibilityLabel={label}
        accessibilityValue={value ? { text: value } : undefined}
        disabled={disabled}
        onPress={onPress}
        // A full-width row dips less than a button; the chevron carries most of
        // the state change.
        scaleTo={0.98}
        feedback="tap"
        style={[styles.row, disabled && styles.dimmed]}>
        {leading ?? (
          <View style={[styles.well, { backgroundColor: colors.surfaceMuted }]}>
            <Ionicons name={icon} size={16} color={colors.textTertiary} />
          </View>
        )}

        <Text variant="bodyStrong" style={styles.flex} numberOfLines={1}>
          {label}
        </Text>

        {value ? (
          <Text variant="caption" color="textSecondary" numberOfLines={1} style={styles.value}>
            {value}
          </Text>
        ) : null}

        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={16}
          color={colors.textTertiary}
        />
      </PressableScale>

      {expanded ? <View style={styles.panel}>{children}</View> : null}
    </View>
  );
}

type AssigneeChipProps = {
  label: string;
  member?: FamilyMember;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
};

/**
 * One assignee choice. Selection is carried three ways — the soft fill, the
 * brand border and a tick — because the fill alone is a pale green that a
 * bright screen outdoors loses entirely.
 */
function AssigneeChip({ label, member, selected, disabled, onPress }: AssigneeChipProps) {
  const { colors } = useTheme();

  return (
    <PressableScale
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      // Moving within a set, not committing — the same feedback `Segmented`
      // uses for the due date row above.
      feedback="select"
      // A chip is small enough that a full-button dip overshoots it.
      scaleTo={0.94}
      style={[
        styles.chip,
        {
          backgroundColor: selected ? colors.primarySoft : colors.surface,
          borderColor: selected ? colors.primary : colors.border,
        },
        disabled && styles.dimmed,
      ]}>
      {member ? (
        <Avatar
          initials={member.initials}
          colorIndex={member.colorIndex}
          avatar={member.avatar}
          size="sm"
        />
      ) : (
        <View
          style={[styles.well, { backgroundColor: selected ? colors.surface : colors.surfaceMuted }]}>
          <Ionicons
            name="people-outline"
            size={16}
            color={selected ? colors.primary : colors.textTertiary}
          />
        </View>
      )}

      <Text variant="captionStrong" color={selected ? 'primary' : 'textSecondary'}>
        {label}
      </Text>

      {selected ? <Ionicons name="checkmark-circle" size={16} color={colors.primary} /> : null}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  // Yields to the panel's own cap so the action row below can never be pushed
  // off the bottom; `maxHeight` is applied inline, from the window.
  scroll: { flexShrink: 1 },
  form: { gap: Spacing.lg, paddingBottom: Spacing.sm },
  // The three settings read as one block, the way a grouped list does.
  group: {
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  divided: { borderBottomWidth: StyleSheet.hairlineWidth },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  // Bounded so a long name cannot squeeze the label it sits beside.
  value: { maxWidth: '45%' },
  panel: { gap: Spacing.sm, paddingHorizontal: Spacing.md, paddingBottom: Spacing.md },
  well: {
    width: WELL_SIZE,
    height: WELL_SIZE,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingLeft: Spacing.xs,
    paddingRight: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  dimmed: { opacity: 0.4 },
  error: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.md,
  },
  // A line above the actions so they read as the panel's footer once the list
  // above them is scrolling under it.
  actions: {
    flexDirection: 'row',
    gap: Spacing.md,
    paddingTop: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
