/**
 * The form that asks the family a question.
 *
 * Split the way `TaskComposerForm` / `TaskComposer` are, and for the same
 * reason: Chat needs the bare content because its "+" menu, the message menu,
 * the task form, the photo confirmation and this all share a single `Sheet` —
 * presenting and dismissing two native modals in one frame is unreliable on
 * iOS, so the panel swaps its children rather than handing off.
 *
 * **Every control here maps to a column**, which is what bounds the form. Two
 * to four options, because `private.poll_options_valid()` says so; 200
 * characters of question and 60 of answer, because the constraints say so.
 * There is no "allow multiple answers", no closing date and no anonymity
 * switch, because `chat_poll_votes` is one row per member per poll with nothing
 * else on it — offering any of the three would be offering a setting the schema
 * cannot store.
 *
 * The two extra option fields are **revealed, not scrolled to**. A form showing
 * four empty boxes reads as four things to fill in, when the honest shape is
 * "two answers, and up to two more if you want them". Blank fields are dropped
 * by `pollService.createPoll` rather than refused, so a third box left untouched
 * is three options rather than an error.
 *
 * Keyboard avoidance is deliberately absent: `Sheet` owns the one
 * `KeyboardAvoidingView`, and a second nested inside it applies the inset twice
 * and lifts the panel clear off the keyboard it was avoiding. What this owes
 * instead is a scroll view that yields (`flexShrink: 1`), so the footer stays on
 * screen while the middle shrinks.
 */

import { Ionicons } from '@expo/vector-icons';
import { useRef, useState } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { Button, PressableScale, Sheet, Text, TextField } from '@/components/ui';
import type { NewPoll } from '@/context/FamilyContext';
import { useIsMounted } from '@/hooks/use-safe-back';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/hooks/use-translation';
import {
  MAX_POLL_OPTION_LENGTH,
  MAX_POLL_OPTIONS,
  MAX_POLL_QUESTION_LENGTH,
  MIN_POLL_OPTIONS,
} from '@/services/pollService';
import { Radius, Spacing } from '@/theme';

/**
 * How much of the window the scrolling half may take, and the floor it may not
 * shrink past. Derived rather than fixed, exactly as the task composer derives
 * it: a constant tall enough for a large phone pushes the action row off a
 * small one the moment the keyboard opens.
 */
const SCROLL_HEIGHT_RATIO = 0.5;
const MIN_SCROLL_HEIGHT = 200;

type PollCreateFormProps = {
  /** Resolves to an error message to show in place, or null once stored. */
  onCreate: (input: NewPoll) => Promise<string | null>;
  /** Called on cancel and on success — the caller closes whatever holds this. */
  onClose: () => void;
};

export function PollCreateForm({ onCreate, onClose }: PollCreateFormProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const isMounted = useIsMounted();
  const { height: windowHeight } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);

  const [question, setQuestion] = useState('');
  /**
   * Always `MAX_POLL_OPTIONS` long, with the tail empty and hidden.
   *
   * A fixed-length array rather than one that grows and shrinks: an index here
   * is what the field is keyed and written by, so splicing would move the
   * caret's field out from under a finger mid-edit. `visibleCount` is what
   * decides how many of them are drawn.
   */
  const [options, setOptions] = useState<string[]>(() => Array(MAX_POLL_OPTIONS).fill(''));
  const [visibleCount, setVisibleCount] = useState(MIN_POLL_OPTIONS);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedQuestion = question.trim();
  // Only the *shown* fields count. A value stranded in a hidden field — typed,
  // then the row removed — is not something the user is still asking, and
  // counting it would let the form submit an option nobody can see.
  const filled = options.slice(0, visibleCount).map((option) => option.trim()).filter(Boolean);

  const canSubmit =
    trimmedQuestion.length > 0 &&
    trimmedQuestion.length <= MAX_POLL_QUESTION_LENGTH &&
    filled.length >= MIN_POLL_OPTIONS &&
    !isCreating;

  const scrollMaxHeight = Math.max(MIN_SCROLL_HEIGHT, windowHeight * SCROLL_HEIGHT_RATIO);

  function setOptionAt(index: number, value: string) {
    setOptions((previous) => previous.map((option, at) => (at === index ? value : option)));
  }

  /**
   * Reveals one more field and brings the foot of the panel into view — the
   * keyboard arrives a beat later and the new field is already where it needs
   * to be. The same trick the task composer's note row uses.
   */
  function addOption() {
    setVisibleCount((previous) => Math.min(MAX_POLL_OPTIONS, previous + 1));
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }

  /**
   * Hides the last field *and blanks it*, so nothing typed into a row the user
   * has removed can survive to be submitted or to reappear when they add one
   * back. Never below `MIN_POLL_OPTIONS`, which is the constraint's floor.
   */
  function removeLastOption() {
    if (visibleCount <= MIN_POLL_OPTIONS) return;

    const last = visibleCount - 1;

    setOptionAt(last, '');
    setVisibleCount(last);
  }

  async function submit() {
    if (!canSubmit) return;

    setIsCreating(true);
    setError(null);

    const failure = await onCreate({ question: trimmedQuestion, options: filled });

    if (!isMounted()) return;

    setIsCreating(false);

    // The form survives a failure so nothing typed is lost — the same rule the
    // task composer and the chat composer both follow.
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
        // A tap on "Add an answer" while a field has focus has to land on the
        // button, not be eaten dismissing the keyboard.
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={styles.form}>
        <TextField
          label={t('poll.questionLabel')}
          value={question}
          onChangeText={setQuestion}
          placeholder={t('poll.questionPlaceholder')}
          maxLength={MAX_POLL_QUESTION_LENGTH}
          returnKeyType="next"
          editable={!isCreating}
        />

        <View style={styles.options}>
          {options.slice(0, visibleCount).map((option, index) => (
            <TextField
              // The index is the key because it is also what the vote stores —
              // a position in the array, not a value. Reordering is not offered
              // for the same reason.
              key={index}
              label={t('poll.optionLabel', { number: index + 1 })}
              value={option}
              onChangeText={(value) => setOptionAt(index, value)}
              placeholder={t('poll.optionPlaceholder')}
              maxLength={MAX_POLL_OPTION_LENGTH}
              returnKeyType={index === visibleCount - 1 ? 'done' : 'next'}
              editable={!isCreating}
            />
          ))}

          <View style={styles.optionActions}>
            {visibleCount < MAX_POLL_OPTIONS ? (
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={t('poll.addOption')}
                disabled={isCreating}
                onPress={addOption}
                // Moving within a set rather than committing anything.
                feedback="select"
                // A short text action, so it dips further than a button would.
                scaleTo={0.94}
                hitSlop={8}
                style={styles.optionAction}>
                <Ionicons name="add-circle-outline" size={16} color={colors.accent} />
                <Text variant="captionStrong" color="accent">
                  {t('poll.addOption')}
                </Text>
              </PressableScale>
            ) : null}

            {visibleCount > MIN_POLL_OPTIONS ? (
              <PressableScale
                accessibilityRole="button"
                accessibilityLabel={t('poll.removeOption')}
                disabled={isCreating}
                onPress={removeLastOption}
                feedback="select"
                scaleTo={0.94}
                hitSlop={8}
                style={styles.optionAction}>
                <Ionicons name="remove-circle-outline" size={16} color={colors.textTertiary} />
                <Text variant="captionStrong" color="textTertiary">
                  {t('poll.removeOption')}
                </Text>
              </PressableScale>
            ) : null}
          </View>
        </View>

        {/* Says what the poll actually becomes: a message of yours in the chat,
            because that is the row the question is stored as — and the reason
            deleting that message is what removes the poll. */}
        <Text variant="caption" color="textTertiary">
          {t('poll.composerHint')}
        </Text>

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
          label={t('poll.submit')}
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

type PollCreateSheetProps = PollCreateFormProps & { visible: boolean };

/**
 * The form in a sheet of its own.
 *
 * Chat does not use this — it holds the bare form in its single panel — but a
 * second entry point would, and keeping the pair symmetrical with
 * `TaskComposer` is what stops the next one reaching for a `Modal` of its own.
 */
export function PollCreateSheet({ visible, onClose, ...form }: PollCreateSheetProps) {
  const { t } = useTranslation();

  return (
    <Sheet
      visible={visible}
      title={t('poll.composerTitle')}
      description={t('poll.composerDescription')}
      onClose={onClose}>
      {/* Mounted only while open, so closing clears the draft: the form holds
          its fields in local state and has no reset of its own. */}
      {visible ? <PollCreateForm onClose={onClose} {...form} /> : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  // Yields to the panel's own cap so the action row can never be pushed off the
  // bottom; `maxHeight` is applied inline, from the window.
  scroll: { flexShrink: 1 },
  form: { gap: Spacing.lg, paddingBottom: Spacing.sm },
  options: { gap: Spacing.md },
  optionActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.lg },
  optionAction: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
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
