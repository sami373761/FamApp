/**
 * Everything the Map does with a saved place, in one bottom sheet.
 *
 * Five states share the panel — nothing, a place's details, the form that
 * creates or edits one, the confirmation that deletes it, and the notice that
 * the family has no room for another — and the sheet swaps its children rather
 * than handing off to a second one. That is the same
 * constraint Chat's "+" menu works under: presenting one `Modal` while
 * dismissing another in the same frame is unreliable on iOS. It is also why
 * delete is confirmed *here* instead of in a `ConfirmDialog`, which would be
 * exactly that second modal.
 *
 * Every write stays inside the panel, so a failure reports itself in place
 * instead of dismissing and leaving the user guessing.
 */

import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { PLACE_ICONS } from '@/components/map/place-pin';
import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/ui/sheet';
import { Text } from '@/components/ui/text';
import { TextField } from '@/components/ui/text-field';
import type { NewPlace } from '@/context/FamilyContext';
import { memberName } from '@/data/format';
import { formatCoordinates, type Coordinates } from '@/data/geo';
import { PLACE_CATEGORIES, placeCategoryLabel } from '@/data/places';
import { GOLD_PLACE_LIMIT, placeLimitFor } from '@/data/premium';
import type { FamilyMember, PlaceCategory, SavedPlace } from '@/data/types';
import { useHaptics } from '@/hooks/use-haptics';
import { useIsMounted } from '@/hooks/use-safe-back';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/hooks/use-translation';
import { MAX_PLACE_TITLE_LENGTH } from '@/services/placesService';
import { Radius, Spacing } from '@/theme';

/**
 * What the sheet is currently showing. Held by the Map screen rather than in
 * here, because the same value decides which pin wears a halo and whether the
 * draft pin is on the canvas — two things that live on the map, not in a panel.
 */
export type PlaceSheetState =
  | { mode: 'none' }
  | { mode: 'details'; placeId: string }
  /** `placeId` null is a new place; set is the one being moved or renamed. */
  | { mode: 'form'; placeId: string | null; coordinates: Coordinates }
  | { mode: 'delete'; placeId: string }
  /**
   * The family is at its tier's saved-place ceiling and this would have been a
   * new place. It carries no coordinate on purpose: the pin is not the subject
   * any more, and holding one would invite "save it anyway".
   */
  | { mode: 'locked' };

type PlaceSheetProps = {
  state: PlaceSheetState;
  places: SavedPlace[];
  currentUserId?: string | null;
  /** Whether the family holds Gold — decides which ceiling the notice names. */
  isPremium: boolean;
  /** Opens the paywall. Routing belongs to the screen, not to a panel. */
  onUpgrade: () => void;
  /** Resolves the owner of a place to a name; the roster lives on the screen. */
  getMember: (id: string | null | undefined) => FamilyMember | undefined;
  onClose: () => void;
  onEdit: (place: SavedPlace) => void;
  onRequestDelete: (place: SavedPlace) => void;
  /** `placeId` null creates; set edits. Resolves to a message, or null. */
  onSubmit: (placeId: string | null, input: NewPlace) => Promise<string | null>;
  onDelete: (placeId: string) => Promise<string | null>;
};

export function PlaceSheet({
  state,
  places,
  currentUserId,
  isPremium,
  onUpgrade,
  getMember,
  onClose,
  onEdit,
  onRequestDelete,
  onSubmit,
  onDelete,
}: PlaceSheetProps) {
  const { t } = useTranslation();

  // `none` and `locked` describe no particular place, so neither has a
  // `placeId` to look one up with.
  const place =
    state.mode === 'none' || state.mode === 'locked'
      ? null
      : places.find((candidate) => candidate.id === state.placeId) ?? null;

  const title =
    state.mode === 'form'
      ? state.placeId
        ? t('places.editTitle')
        : t('places.addTitle')
      : state.mode === 'delete'
        ? t('places.deleteTitle')
        : state.mode === 'locked'
          ? t('places.limitTitle')
          : t('places.detailsTitle');

  return (
    <Sheet visible={state.mode !== 'none'} title={title} onClose={onClose}>
      {/*
        Keyed on the mode *and* the place, so switching between them remounts
        the child: the form holds its draft in local state and has no reset of
        its own, exactly like `TaskComposerForm`.
      */}
      {state.mode === 'form' ? (
        <PlaceForm
          key={`form:${state.placeId ?? 'new'}`}
          places={places}
          currentUserId={currentUserId}
          isPremium={isPremium}
          existing={place}
          coordinates={state.coordinates}
          onSubmit={(input) => onSubmit(state.placeId, input)}
          onClose={onClose}
        />
      ) : state.mode === 'details' && place ? (
        <PlaceDetails
          place={place}
          owner={getMember(place.ownerId)}
          isOwn={place.ownerId === currentUserId}
          onEdit={() => onEdit(place)}
          onDelete={() => onRequestDelete(place)}
          onClose={onClose}
        />
      ) : state.mode === 'delete' && place ? (
        <PlaceDeleteConfirm
          key={`delete:${place.id}`}
          place={place}
          onConfirm={() => onDelete(place.id)}
          onCancel={onClose}
        />
      ) : state.mode === 'locked' ? (
        <PlaceLimitNotice
          saved={places.length}
          isPremium={isPremium}
          onUpgrade={onUpgrade}
          onClose={onClose}
        />
      ) : null}
    </Sheet>
  );
}

type PlaceFormProps = {
  places: SavedPlace[];
  currentUserId?: string | null;
  /** Only to name the ceiling in the hint; the trigger is what enforces it. */
  isPremium: boolean;
  /** The row being edited, or null when this is a new place. */
  existing: SavedPlace | null;
  coordinates: Coordinates;
  onSubmit: (input: NewPlace) => Promise<string | null>;
  onClose: () => void;
};

function PlaceForm({
  places,
  currentUserId,
  isPremium,
  existing,
  coordinates,
  onSubmit,
  onClose,
}: PlaceFormProps) {
  const { colors } = useTheme();
  const i18n = useTranslation();
  const { t } = i18n;
  const haptic = useHaptics();
  const isMounted = useIsMounted();

  /*
    Which categories are already spoken for. `unique (user_id, category)` is the
    real rule — and the whole of "five places per member" — so this only saves
    the user a round trip; the constraint is still what decides, and its
    violation comes back as `CATEGORY_TAKEN`. The place being edited does not
    count against itself.
  */
  const taken = new Set(
    places
      .filter((candidate) => candidate.ownerId === currentUserId && candidate.id !== existing?.id)
      .map((candidate) => candidate.category),
  );

  const firstFree = PLACE_CATEGORIES.find((candidate) => !taken.has(candidate)) ?? null;

  const [category, setCategory] = useState<PlaceCategory | null>(existing?.category ?? firstFree);
  const [title, setTitle] = useState(
    existing?.title ?? (firstFree ? placeCategoryLabel(i18n, firstFree) : ''),
  );
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = title.trim();
  const canSubmit = !!category && trimmed.length > 0 && !isSaving;

  /**
   * Picking a category renames the place to match, but only while the name is
   * still the one a category handed over. Somebody who typed "Beach Park" keeps
   * it; somebody who has typed nothing gets a sensible name for free.
   */
  function pickCategory(next: PlaceCategory) {
    const wasDefault =
      trimmed.length === 0 ||
      PLACE_CATEGORIES.some((candidate) => placeCategoryLabel(i18n, candidate) === trimmed);

    setCategory(next);

    if (wasDefault) setTitle(placeCategoryLabel(i18n, next));
  }

  async function submit() {
    if (!canSubmit || !category) return;

    setIsSaving(true);
    setError(null);

    const failure = await onSubmit({
      category,
      title: trimmed,
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
    });

    if (!isMounted()) return;

    setIsSaving(false);

    // The form survives a failure so nothing typed is lost.
    if (failure) {
      setError(failure);
      return;
    }

    haptic('success');
    onClose();
  }

  return (
    <>
      <ScrollView
        style={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.form}>
        <View style={styles.field}>
          <Text variant="captionStrong" color="textSecondary">
            {t('places.categoryLabel')}
          </Text>

          <View style={styles.chips}>
            {PLACE_CATEGORIES.map((candidate) => (
              <CategoryChip
                key={candidate}
                category={candidate}
                label={placeCategoryLabel(i18n, candidate)}
                selected={category === candidate}
                // A category already saved is dimmed rather than hidden: the
                // five are the whole vocabulary, and one silently missing reads
                // as a bug rather than as "you already have one".
                disabled={isSaving || taken.has(candidate)}
                onPress={() => pickCategory(candidate)}
              />
            ))}
          </View>

          <Text variant="caption" color="textTertiary">
            {taken.size >= PLACE_CATEGORIES.length
              ? t('places.allSaved')
              : t('places.categoryHint')}
          </Text>

          {/*
            The family's ceiling, said before it is reached rather than only at
            the refusal. Only while creating: editing a place cannot use up
            room it already occupies, so the count would be noise there.
          */}
          {existing ? null : (
            <Text variant="caption" color="textTertiary">
              {t('places.limitCount', { saved: places.length, limit: placeLimitFor(isPremium) })}
            </Text>
          )}
        </View>

        <TextField
          label={t('places.titleLabel')}
          value={title}
          onChangeText={setTitle}
          placeholder={t('places.titlePlaceholder')}
          autoCapitalize="words"
          maxLength={MAX_PLACE_TITLE_LENGTH}
          returnKeyType="done"
          editable={!isSaving}
        />

        {/*
          The coordinates the pin is on. `saved_places` stores no address and
          nothing here geocodes one, so this is the whole of where it is — and
          the sheet has to show it, because moving the pin is a long press away.
        */}
        <View style={[styles.pinRow, { backgroundColor: colors.surfaceMuted }]}>
          <Ionicons name="location-outline" size={16} color={colors.textTertiary} />
          <Text variant="caption" color="textSecondary" style={styles.flex}>
            {t('places.pinAt', { coordinates: formatCoordinates(coordinates) })}
          </Text>
        </View>

        <Text variant="caption" color="textTertiary">
          {t('places.moveHint')}
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

      <View style={styles.actions}>
        <Button
          label={t('common.cancel')}
          variant="secondary"
          size="md"
          disabled={isSaving}
          onPress={onClose}
          style={styles.flex}
        />
        <Button
          label={existing ? t('places.saveChanges') : t('places.save')}
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

type PlaceDetailsProps = {
  place: SavedPlace;
  owner: FamilyMember | undefined;
  isOwn: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
};

function PlaceDetails({ place, owner, isOwn, onEdit, onDelete, onClose }: PlaceDetailsProps) {
  const { colors } = useTheme();
  const i18n = useTranslation();
  const { t } = i18n;

  return (
    <>
      <View style={styles.header}>
        <View style={[styles.headerIcon, { backgroundColor: colors.primarySoft }]}>
          <Ionicons name={PLACE_ICONS[place.category]} size={22} color={colors.primary} />
        </View>

        <View style={styles.headerText}>
          <Text variant="subheading" numberOfLines={1}>
            {place.title}
          </Text>
          <Text variant="caption" color="textSecondary">
            {placeCategoryLabel(i18n, place.category)}
          </Text>
        </View>
      </View>

      <View style={[styles.pinRow, { backgroundColor: colors.surfaceMuted }]}>
        <Ionicons name="location-outline" size={16} color={colors.textTertiary} />
        <Text variant="caption" color="textSecondary" style={styles.flex}>
          {formatCoordinates(place)}
        </Text>
      </View>

      <Text variant="caption" color="textTertiary">
        {isOwn
          ? t('places.savedByYou')
          : owner
            ? t('places.savedBy', { name: memberName(i18n, owner) })
            : // The owner has left the family since; the place is still theirs
              // to delete, so it is not claimed for anybody else.
              t('places.savedBySomeone')}
      </Text>

      {/*
        Edit and delete are offered only to the author, because
        `saved_places: update own` and `: delete own` are what actually decide.
        A button that always failed would be worse than one that is not there.
      */}
      {isOwn ? (
        <View style={styles.actions}>
          <Button
            label={t('places.delete')}
            variant="danger"
            size="md"
            onPress={onDelete}
            style={styles.flex}
          />
          <Button label={t('places.edit')} size="md" onPress={onEdit} style={styles.flex} />
        </View>
      ) : (
        <Button label={t('common.close')} variant="secondary" size="md" onPress={onClose} />
      )}
    </>
  );
}

type PlaceDeleteConfirmProps = {
  place: SavedPlace;
  onConfirm: () => Promise<string | null>;
  onCancel: () => void;
};

function PlaceDeleteConfirm({ place, onConfirm, onCancel }: PlaceDeleteConfirmProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const haptic = useHaptics();
  const isMounted = useIsMounted();

  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setIsDeleting(true);
    setError(null);

    // Fired on the press rather than on the result: a successful delete removes
    // the row this panel describes, so the screen closes it and this component
    // is gone before the await returns. Confirming a destructive action is what
    // `warning` is for anyway — the buzz belongs to the decision.
    haptic('warning');

    const failure = await onConfirm();

    if (!isMounted()) return;

    setIsDeleting(false);

    if (failure) setError(failure);
  }

  return (
    <>
      <Text variant="body" color="textSecondary">
        {t('places.deleteMessage', { title: place.title })}
      </Text>

      {error ? (
        <View style={[styles.error, { backgroundColor: colors.dangerSoft }]}>
          <Ionicons name="alert-circle-outline" size={18} color={colors.danger} />
          <Text variant="caption" color="danger" style={styles.flex}>
            {error}
          </Text>
        </View>
      ) : null}

      <View style={styles.actions}>
        <Button
          label={t('common.cancel')}
          variant="secondary"
          size="md"
          disabled={isDeleting}
          onPress={onCancel}
          style={styles.flex}
        />
        <Button
          label={t('places.delete')}
          variant="danger"
          size="md"
          loading={isDeleting}
          onPress={() => void confirm()}
          style={styles.flex}
        />
      </View>
    </>
  );
}

/**
 * The family has no room for another saved place.
 *
 * Shown *instead of* the form, not as an error after it. The write would be
 * refused by `check_saved_place_limit()` either way, and letting someone pick a
 * category and type a name first only makes the refusal cost more — the same
 * reason a category already taken is dimmed in the form rather than reported
 * afterwards.
 *
 * It says the number rather than the word "limit": what is actually true is
 * "your family has saved 2 of 2", and the count is the part that tells somebody
 * whether deleting one is worth it.
 *
 * Two audiences, and the difference matters. A free family is one press from
 * more room, so the primary action is the paywall. A family already on Gold is
 * at the real ceiling and has nothing to buy — offering them an upgrade would
 * be selling them what they have — so they get the ceiling stated and the
 * suggestion to make room.
 */
function PlaceLimitNotice({
  saved,
  isPremium,
  onUpgrade,
  onClose,
}: {
  saved: number;
  isPremium: boolean;
  onUpgrade: () => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation();

  const limit = placeLimitFor(isPremium);

  return (
    <>
      <View style={styles.header}>
        {/* `warning` is Gold's colour everywhere else in the app, and this is a
            Gold surface — the well takes it rather than the usual green. */}
        <View style={[styles.headerIcon, { backgroundColor: colors.warningSoft }]}>
          <Ionicons name="bookmark" size={22} color={colors.warning} />
        </View>

        <View style={styles.headerText}>
          <Text variant="subheading">{t('places.limitTitle')}</Text>
          <Text variant="caption" color="textSecondary">
            {t('places.limitCount', { saved, limit })}
          </Text>
        </View>
      </View>

      <Text variant="body" color="textSecondary">
        {isPremium
          ? t('places.limitGoldBody')
          : t('places.limitFreeBody', { limit, gold: GOLD_PLACE_LIMIT })}
      </Text>

      {isPremium ? (
        <Button label={t('common.close')} variant="secondary" size="md" onPress={onClose} />
      ) : (
        <View style={styles.actions}>
          <Button
            label={t('common.cancel')}
            variant="secondary"
            size="md"
            onPress={onClose}
            style={styles.flex}
          />
          <Button
            label={t('places.limitUpgrade')}
            size="md"
            onPress={onUpgrade}
            style={styles.flex}
          />
        </View>
      )}
    </>
  );
}

type CategoryChipProps = {
  category: PlaceCategory;
  label: string;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
};

function CategoryChip({ category, label, selected, disabled, onPress }: CategoryChipProps) {
  const { colors } = useTheme();

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: selected ? colors.primarySoft : colors.surface,
          borderColor: selected ? colors.primary : colors.border,
        },
        (pressed || disabled) && styles.dimmed,
      ]}>
      <Ionicons
        name={PLACE_ICONS[category]}
        size={16}
        color={selected ? colors.primary : colors.textTertiary}
      />
      <Text variant="captionStrong" color={selected ? 'primary' : 'textSecondary'}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  // Capped so the keyboard cannot push the buttons off a short screen.
  scroll: { maxHeight: 380 },
  form: { gap: Spacing.lg, paddingBottom: Spacing.sm },
  field: { gap: Spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingLeft: Spacing.sm,
    paddingRight: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  dimmed: { opacity: 0.5 },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  headerIcon: {
    width: 44,
    height: 44,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flex: 1, gap: 2 },
  pinRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.md,
  },
  error: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.md,
  },
  actions: { flexDirection: 'row', gap: Spacing.md },
});
