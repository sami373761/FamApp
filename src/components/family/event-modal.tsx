/**
 * Adding and removing the dates a family keeps.
 *
 * **One `Sheet` that swaps its children**, across `'form' | 'locked' |
 * 'delete'`, for the reason Chat's single panel and the Map's place sheet both
 * exist: presenting one native `Modal` while dismissing another in the same
 * frame is unreliable on iOS. That is also why deleting is confirmed *inside*
 * this sheet rather than through `ConfirmDialog`, which would be exactly the
 * second modal — the same trade the place sheet already makes.
 *
 * **`locked` is the free tier's ceiling explained rather than merely enforced.**
 * Past it the sheet opens in that mode instead of the form: the insert would be
 * refused by `check_family_event_limit()` anyway, and letting somebody pick a
 * type and type a title first only makes the refusal cost more. Its primary
 * action is the paywall — which is what "trigger the paywall" means here, with
 * a sentence in front of it saying why.
 *
 * A Gold family never sees `locked`, because Gold is genuinely uncapped. That
 * asymmetry is why this mode has no "delete one to make room" branch, unlike
 * the map's: there is no Gold family that can hit this ceiling to write it for.
 *
 * **Birthdays are not manageable from here and must not be.** A birthday is
 * `profiles.birth_date` on somebody's own row — it is edited in Edit profile,
 * by them — and offering it here would either invent a row the countdown does
 * not read or let one member rewrite another's identity. The card that opens
 * this sheet says as much.
 */

import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { DateField } from '@/components/family/date-field';
import { Button, PressableScale, Sheet, Text, TextField } from '@/components/ui';
import type { NewEvent } from '@/context/FamilyContext';
import type { FamilyEvent, FamilyEventType } from '@/data/types';
import { useIsMounted } from '@/hooks/use-safe-back';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/hooks/use-translation';
import { EVENT_TYPES, MAX_EVENT_TITLE_LENGTH } from '@/services/eventsService';
import { Radius, Spacing } from '@/theme';

/** Same derivation the task and poll composers use, for the same keyboard reason. */
const SCROLL_HEIGHT_RATIO = 0.5;
const MIN_SCROLL_HEIGHT = 200;

/**
 * One glyph per `family_events_type_valid` value.
 *
 * The closed set on the column is what makes this table possible — an open one
 * would reach a screen with no icon, which is the same argument
 * `PLACE_ICONS` makes for `saved_places.category`.
 */
export const EVENT_ICONS: Record<FamilyEventType, keyof typeof Ionicons.glyphMap> = {
  birthday: 'gift-outline',
  anniversary: 'heart-outline',
  holiday: 'sunny-outline',
  trip: 'airplane-outline',
  other: 'calendar-outline',
};

/** Which face the panel is showing. `none` closes it. */
export type EventModalMode = 'none' | 'form' | 'locked' | 'delete';

type EventModalProps = {
  mode: EventModalMode;
  /** The event `delete` is asking about. Ignored in the other modes. */
  target: FamilyEvent | null;
  /** How many the family already holds, and its ceiling — the `locked` copy. */
  eventCount: number;
  /** Resolves to an error message to show in place, or null once stored. */
  onCreate: (input: NewEvent) => Promise<string | null>;
  onDelete: (eventId: string) => Promise<string | null>;
  /** Pushes `/premium`. The caller closes this sheet first — two modals again. */
  onUpgrade: () => void;
  onClose: () => void;
};

export function EventModal({
  mode,
  target,
  eventCount,
  onCreate,
  onDelete,
  onUpgrade,
  onClose,
}: EventModalProps) {
  const { t } = useTranslation();

  return (
    <Sheet
      visible={mode !== 'none'}
      title={
        mode === 'locked'
          ? t('events.lockedTitle')
          : mode === 'delete'
            ? t('events.deleteTitle')
            : t('events.composerTitle')
      }
      description={mode === 'form' ? t('events.composerDescription') : undefined}
      // Naming which face is showing is what lets the incoming content fade and
      // lift into place instead of being swapped between two frames.
      contentKey={mode}
      onClose={onClose}>
      {/* Each is mounted only while it is the mode, which is what clears the
          form's draft on close: it holds its fields in local state and has no
          reset of its own. */}
      {mode === 'form' ? <EventForm onCreate={onCreate} onClose={onClose} /> : null}
      {mode === 'locked' ? (
        <LockedNotice count={eventCount} onUpgrade={onUpgrade} onClose={onClose} />
      ) : null}
      {mode === 'delete' && target ? (
        <DeleteConfirmation event={target} onDelete={onDelete} onClose={onClose} />
      ) : null}
    </Sheet>
  );
}

type EventFormProps = {
  onCreate: (input: NewEvent) => Promise<string | null>;
  onClose: () => void;
};

function EventForm({ onCreate, onClose }: EventFormProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const isMounted = useIsMounted();
  const { height: windowHeight } = useWindowDimensions();

  const [title, setTitle] = useState('');
  /** `YYYY-MM-DD`, `''` when empty, or null while it is being typed. */
  const [eventDate, setEventDate] = useState<string | null>('');
  const [eventType, setEventType] = useState<FamilyEventType>('anniversary');
  /**
   * Defaults to recurring, because most of what a family enters by hand does —
   * an anniversary, a name day, a holiday that falls on the same date. A trip
   * is the one that usually does not, which is why this is a switchable row and
   * not an assumption made from `eventType`.
   */
  const [isAnnual, setIsAnnual] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = title.trim();
  const canSubmit =
    trimmed.length > 0 && trimmed.length <= MAX_EVENT_TITLE_LENGTH && !!eventDate && !isSaving;

  const scrollMaxHeight = Math.max(MIN_SCROLL_HEIGHT, windowHeight * SCROLL_HEIGHT_RATIO);

  async function submit() {
    if (!canSubmit || !eventDate) return;

    setIsSaving(true);
    setError(null);

    const failure = await onCreate({ title: trimmed, eventDate, eventType, isAnnual });

    if (!isMounted()) return;

    setIsSaving(false);

    // The form survives a failure so nothing typed is lost — including a
    // `LIMIT_REACHED` from a family that filled its last slot on another device
    // while this sheet was open, which is the one refusal the client's own
    // check cannot have caught.
    if (failure) {
      setError(failure);
      return;
    }

    onClose();
  }

  return (
    <>
      <ScrollView
        style={[styles.scroll, { maxHeight: scrollMaxHeight }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={styles.form}>
        <TextField
          label={t('events.titleLabel')}
          value={title}
          onChangeText={setTitle}
          placeholder={t('events.titlePlaceholder')}
          autoCapitalize="words"
          maxLength={MAX_EVENT_TITLE_LENGTH}
          editable={!isSaving}
        />

        <DateField
          label={t('events.dateLabel')}
          value=""
          onChange={setEventDate}
          editable={!isSaving}
        />

        <View style={styles.field}>
          <Text variant="captionStrong" color="textSecondary">
            {t('events.typeLabel')}
          </Text>

          {/* Chips rather than a `Segmented`: five options do not fit that
              control, and each carries a glyph the label alone cannot. */}
          <View style={styles.chips} accessibilityRole="radiogroup">
            {EVENT_TYPES.map((type) => (
              <TypeChip
                key={type}
                type={type}
                selected={eventType === type}
                disabled={isSaving}
                onPress={() => setEventType(type)}
              />
            ))}
          </View>
        </View>

        <PressableScale
          accessibilityRole="checkbox"
          accessibilityState={{ checked: isAnnual, disabled: isSaving }}
          accessibilityLabel={t('events.annualLabel')}
          disabled={isSaving}
          onPress={() => setIsAnnual((previous) => !previous)}
          feedback="select"
          scaleTo={0.99}
          highlightColor={colors.surfaceMuted}
          highlightRadius={Radius.md}
          style={styles.annual}>
          <Ionicons
            name={isAnnual ? 'checkbox' : 'square-outline'}
            size={20}
            color={isAnnual ? colors.primary : colors.textTertiary}
          />
          <View style={styles.flex}>
            <Text variant="body">{t('events.annualLabel')}</Text>
            <Text variant="caption" color="textTertiary">
              {isAnnual ? t('events.annualHint') : t('events.onceHint')}
            </Text>
          </View>
        </PressableScale>

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
          disabled={isSaving}
          onPress={onClose}
          style={styles.flex}
        />
        <Button
          label={t('events.submit')}
          size="md"
          loading={isSaving}
          disabled={!canSubmit}
          onPress={() => void submit()}
          style={styles.flex}
        />
      </View>
    </>
  );
}

/**
 * The free tier's ceiling, named and explained.
 *
 * It says the count rather than "you have reached your limit", because the
 * number is the whole of what somebody needs to decide what to do — and the two
 * ways out are both offered: pay, or remove the one they have.
 */
function LockedNotice({
  count,
  onUpgrade,
  onClose,
}: {
  count: number;
  onUpgrade: () => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation();

  return (
    <View style={styles.locked}>
      {/* `warning` is the whole of Gold's colour across the app — the banner,
          the Profile badge, the paywall's hero. A padlock in any other tone
          would read as an error rather than as an offer. */}
      <View style={[styles.lockedIcon, { backgroundColor: colors.warningSoft }]}>
        <Ionicons name="lock-closed-outline" size={22} color={colors.warning} />
      </View>

      <Text variant="body">{t('events.lockedBody', { count })}</Text>

      <Text variant="caption" color="textTertiary">
        {t('events.lockedBirthdays')}
      </Text>

      <View style={styles.lockedActions}>
        <Button label={t('events.lockedUpgrade')} size="md" onPress={onUpgrade} />
        <Button label={t('common.close')} variant="ghost" size="md" onPress={onClose} />
      </View>
    </View>
  );
}

/**
 * Deleting, confirmed in place.
 *
 * The write stays *inside* this face rather than being handed back to the card,
 * so a refusal — somebody else's date, or one already gone — is reported here
 * instead of dismissing and leaving the failure somewhere else. That is
 * `ConfirmDialog`'s own contract, reproduced here because a dialog would be the
 * second modal this sheet exists to avoid.
 *
 * On success the caller closes the sheet, because this face is describing a row
 * that no longer exists and would otherwise be left holding its name.
 */
function DeleteConfirmation({
  event,
  onDelete,
  onClose,
}: {
  event: FamilyEvent;
  onDelete: (eventId: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const isMounted = useIsMounted();

  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setIsDeleting(true);
    setError(null);

    const failure = await onDelete(event.id);

    if (!isMounted()) return;

    setIsDeleting(false);

    if (failure) {
      setError(failure);
      return;
    }

    onClose();
  }

  return (
    <View style={styles.locked}>
      <View style={[styles.lockedIcon, { backgroundColor: colors.dangerSoft }]}>
        <Ionicons name="trash-outline" size={22} color={colors.danger} />
      </View>

      <Text variant="body">{t('events.deleteBody', { title: event.title })}</Text>

      {error ? (
        <View style={[styles.error, { backgroundColor: colors.dangerSoft }]}>
          <Ionicons name="alert-circle-outline" size={18} color={colors.danger} />
          <Text variant="caption" color="danger" style={styles.flex}>
            {error}
          </Text>
        </View>
      ) : null}

      <View style={[styles.actions, { borderTopColor: colors.separator }]}>
        <Button
          label={t('common.cancel')}
          variant="secondary"
          size="md"
          disabled={isDeleting}
          onPress={onClose}
          style={styles.flex}
        />
        {/*
          `danger` is a *soft* fill, not solid red — the confirm action of a
          destructive question, never a page's main CTA.
        */}
        <Button
          label={t('events.deleteConfirm')}
          variant="danger"
          size="md"
          loading={isDeleting}
          onPress={() => void confirm()}
          style={styles.flex}
        />
      </View>
    </View>
  );
}

function TypeChip({
  type,
  selected,
  disabled,
  onPress,
}: {
  type: FamilyEventType;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const label = t(`eventType.${type}` as const);

  return (
    <PressableScale
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
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
      <Ionicons
        name={EVENT_ICONS[type]}
        size={16}
        color={selected ? colors.primary : colors.textTertiary}
      />
      <Text variant="captionStrong" color={selected ? 'primary' : 'textSecondary'}>
        {label}
      </Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { flexShrink: 1 },
  form: { gap: Spacing.lg, paddingBottom: Spacing.sm },
  field: { gap: Spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  annual: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radius.md,
  },
  dimmed: { opacity: 0.4 },
  locked: { gap: Spacing.md, paddingBottom: Spacing.sm },
  lockedIcon: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockedActions: { gap: Spacing.sm, marginTop: Spacing.sm },
  error: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.md,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.md,
    paddingTop: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
