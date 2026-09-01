/**
 * Editing the three things a member owns about themselves: the name their
 * family sees, the colour they are identified by, and the role they claim.
 *
 * All three are plain columns on the caller's own `profiles` row, so this is an
 * ordinary update rather than an RPC — `profiles: update own` allows it, and
 * `guard_profile_columns()` rejects everything else, which is why nothing here
 * offers `is_admin` or `family_id`. `role` is a self-declared label with no
 * privileges attached; admin rights are separate and not editable from here.
 *
 * Seeded from `profile` (AuthContext) rather than from `currentMember`, because
 * the raw row is already loaded on every screen in this branch — waiting for
 * the family overview would mean a loading state and an effect to fill the form.
 */

import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';

import {
  Button,
  Card,
  NavHeader,
  PressableScale,
  Screen,
  Segmented,
  Text,
  TextField,
  type SegmentedOption,
} from '@/components/ui';
import { roleLabel } from '@/data/format';
import type { FamilyRole } from '@/data/types';
import { useAuth } from '@/hooks/useAuth';
import { useFamily } from '@/hooks/useFamily';
import { useIsMounted, useSafeBack } from '@/hooks/use-safe-back';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/hooks/use-translation';
import { toFamilyRole, updateOwnProfile } from '@/services/familyService';
import { errorText } from '@/services/result';
import { MemberColors, Radius, Spacing } from '@/theme';

/** Mirrors `profiles_display_name_length` — reject it here rather than round-trip. */
const NAME_MIN = 1;
const NAME_MAX = 40;

export default function EditProfileScreen() {
  const { colors } = useTheme();
  const i18n = useTranslation();
  const { t } = i18n;
  const { profile, refreshProfile } = useAuth();

  const roleOptions: readonly SegmentedOption<FamilyRole>[] = [
    { value: 'parent', label: roleLabel(i18n, 'parent') },
    { value: 'child', label: roleLabel(i18n, 'child') },
    { value: 'guardian', label: roleLabel(i18n, 'guardian') },
  ];
  const { refresh } = useFamily();
  // Pushed from Profile, but also reachable by URL on web — and the save below
  // pops *after* two round trips, by which time the user may have left already.
  const goBack = useSafeBack('/(tabs)/profile');
  const isMounted = useIsMounted();

  const [displayName, setDisplayName] = useState(() => profile?.display_name ?? '');
  // The stored index is an index into `MemberColors`, which is the whole choice
  // list — so the row's own colour is always one of the swatches below.
  const [colorIndex, setColorIndex] = useState(() => profile?.color_index ?? 0);
  const [role, setRole] = useState<FamilyRole | null>(() => toFamilyRole(profile?.role));
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const trimmed = displayName.trim();
  const isNameValid = trimmed.length >= NAME_MIN && trimmed.length <= NAME_MAX;
  const hasChanges =
    trimmed !== (profile?.display_name ?? '').trim() ||
    colorIndex !== (profile?.color_index ?? 0) ||
    role !== toFamilyRole(profile?.role);

  async function save() {
    if (!isNameValid) {
      setError(t('editProfile.nameInvalid', { min: NAME_MIN, max: NAME_MAX }));
      return;
    }

    setIsSaving(true);
    setError(null);

    const { error: failure } = await updateOwnProfile({
      displayName: trimmed,
      colorIndex,
      // Omitted rather than sent as null: `updateOwnProfile` builds its patch
      // from the keys present, and there is no "clear my role" affordance.
      ...(role ? { role } : {}),
    });

    if (!isMounted()) return;

    if (failure) {
      setError(errorText(i18n, failure));
      setIsSaving(false);
      return;
    }

    // Both stores hold a copy of this row: the profile is what the guards and
    // this form read, the family list is what every other tab renders.
    await Promise.all([refresh(), refreshProfile()]);

    // Popping unconditionally here would take the Profile tab with it if the
    // user had already gone back during those two round trips.
    if (isMounted()) goBack();
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <NavHeader title={t('editProfile.title')} backFallback="/(tabs)/profile" />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/*
          The form scrolls and the CTA does not: with a keyboard up, the colour
          swatches are the first thing off the bottom of the window, and a save
          button that scrolled away with them would be unreachable.
        */}
        <ScrollView
          style={styles.flex}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled">
          <Text variant="title" style={styles.heading}>
            {t('editProfile.heading')}
          </Text>

          <View style={styles.form}>
            <TextField
              label={t('editProfile.nameLabel')}
              value={displayName}
              onChangeText={setDisplayName}
              placeholder={t('editProfile.namePlaceholder')}
              autoCapitalize="words"
              autoComplete="name"
              returnKeyType="done"
              editable={!isSaving}
              onSubmitEditing={() => void save()}
              error={
                displayName.length > 0 && !isNameValid
                  ? t('editProfile.nameRange', { min: NAME_MIN, max: NAME_MAX })
                  : undefined
              }
            />

            <View style={styles.field}>
              <Text variant="captionStrong" color="textSecondary">
                {t('family.colorLabel')}
              </Text>
              <View style={styles.swatches} accessibilityRole="radiogroup">
                {MemberColors.map((color, index) => (
                  <PressableScale
                    key={color}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: index === colorIndex, disabled: isSaving }}
                    accessibilityLabel={t('family.colorOption', { number: index + 1 })}
                    disabled={isSaving}
                    feedback="select"
                    onPress={() => setColorIndex(index)}
                    style={[
                      styles.swatch,
                      { backgroundColor: color },
                      index === colorIndex && { borderColor: colors.text, borderWidth: 3 },
                      isSaving && styles.swatchDisabled,
                    ]}>
                    {index === colorIndex ? (
                      <Ionicons name="checkmark" size={16} color="#FFFFFF" />
                    ) : null}
                  </PressableScale>
                ))}
              </View>
            </View>

            <View style={styles.field}>
              <Text variant="captionStrong" color="textSecondary">
                {t('editProfile.roleLabel')}
              </Text>
              <Segmented
                label={t('editProfile.roleLabel')}
                options={roleOptions}
                value={role}
                onChange={setRole}
                disabled={isSaving}
              />
              <Text variant="caption" color="textTertiary">
                {t('editProfile.roleHint')}
              </Text>
            </View>
          </View>

          {error ? (
            <Card style={styles.note}>
              <Ionicons name="alert-circle-outline" size={20} color={colors.danger} />
              <Text variant="caption" color="danger" style={styles.flex}>
                {error}
              </Text>
            </Card>
          ) : null}
        </ScrollView>

        <Button
          label={t('editProfile.save')}
          loading={isSaving}
          disabled={isSaving || !isNameValid || !hasChanges}
          onPress={() => void save()}
          style={styles.cta}
        />
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  heading: { marginTop: Spacing.lg },
  form: { gap: Spacing.xl, marginTop: Spacing.xl },
  field: { gap: Spacing.sm },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md },
  swatch: {
    width: 40,
    height: 40,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatchDisabled: { opacity: 0.5 },
  note: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginTop: Spacing.xl },
  cta: { marginBottom: Spacing.lg },
});
