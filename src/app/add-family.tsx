/**
 * Getting a family from *inside* the app — the destination of Profile's
 * "Create or join a family" row.
 *
 * Deliberately not `create-family`. That screen is onboarding: it is the first
 * thing a new account sees, it is the root of its own `Stack.Protected` branch,
 * and its way out is "Skip for now" or "Sign out". None of that makes sense for
 * someone who is already signed in, already has an avatar and is standing in
 * the Profile tab — skipping is what they already did, and offering to sign
 * them out of a settings screen is a trap, not an exit.
 *
 * So this is an ordinary pushed screen: it has a real back button, no skip, no
 * sign out, and it folds *both* choices into one place rather than bouncing
 * between two routes the way onboarding does. It also starts from the identity
 * the member already has instead of asking for it again from blank.
 *
 * Joining or creating from here does not flip any `RootNavigator` guard — the
 * user is already `inApp` with an avatar — so unlike every other family write
 * in the app, this one navigates itself when it is done.
 */

import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';

import { CodeInput } from '@/components/family/code-input';
import {
  Avatar,
  Button,
  Card,
  NavHeader,
  PressableScale,
  Screen,
  Section,
  Segmented,
  Text,
  TextField,
  type SegmentedOption,
} from '@/components/ui';
import { parseAvatarConfig } from '@/data/avatar';
import { initialsFrom, roleLabel, unnamedMember } from '@/data/format';
import type { FamilyRole } from '@/data/types';
import { useAuth } from '@/hooks/useAuth';
import { useFamily } from '@/hooks/useFamily';
import { useIsMounted, useSafeBack } from '@/hooks/use-safe-back';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/hooks/use-translation';
import { createFamily, joinFamily, toFamilyRole } from '@/services/familyService';
import { errorText } from '@/services/result';
import { MemberColors, Radius, Spacing } from '@/theme';

const CODE_LENGTH = 6;

/** Mirrors `profiles_display_name_length`, same as Edit profile. */
const NAME_MIN = 1;
const NAME_MAX = 40;

/** Same six offered during onboarding, so a member's options never change. */
const COLOR_CHOICES = MemberColors.slice(0, 6);

type Mode = 'create' | 'join';

export default function AddFamilyScreen() {
  const { colors } = useTheme();
  const i18n = useTranslation();
  const { t } = i18n;
  const { profile, refreshProfile } = useAuth();

  const modeOptions: readonly SegmentedOption<Mode>[] = [
    { value: 'create', label: t('addFamily.modeCreate') },
    { value: 'join', label: t('addFamily.modeJoin') },
  ];

  const roleOptions: readonly SegmentedOption<FamilyRole>[] = [
    { value: 'parent', label: roleLabel(i18n, 'parent') },
    { value: 'child', label: roleLabel(i18n, 'child') },
    { value: 'guardian', label: roleLabel(i18n, 'guardian') },
  ];
  const { refresh } = useFamily();
  // Pushed from Profile, so back genuinely pops; the fallback only covers a
  // direct URL load on web.
  const goBack = useSafeBack('/(tabs)/profile');
  const isMounted = useIsMounted();

  const [mode, setMode] = useState<Mode>('create');
  const [familyName, setFamilyName] = useState('');
  const [code, setCode] = useState('');
  // Seeded from the profile rather than blank: a member who skipped setup may
  // already have named themselves in Edit profile, and asking twice for
  // something the app is holding is the friction this screen exists to remove.
  const [displayName, setDisplayName] = useState(() => profile?.display_name ?? '');
  const [colorIndex, setColorIndex] = useState(() => profile?.color_index ?? 0);
  const [role, setRole] = useState<FamilyRole | null>(() => toFamilyRole(profile?.role));
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const trimmedName = displayName.trim();
  const isNameValid = trimmedName.length >= NAME_MIN && trimmedName.length <= NAME_MAX;
  const isCreate = mode === 'create';
  const isTargetValid = isCreate ? familyName.trim().length > 1 : code.length === CODE_LENGTH;
  const canSubmit = isNameValid && isTargetValid && !isSubmitting;

  // Their real memoji, so the preview is who they will actually be.
  const avatar = parseAvatarConfig(profile?.avatar_config);

  async function submit() {
    if (!canSubmit) return;

    setIsSubmitting(true);
    setError(null);

    const identity = {
      displayName: trimmedName,
      colorIndex,
      // Omitted rather than sent as null — both RPCs default it, and there is
      // no "clear my role" affordance here.
      ...(role ? { role } : {}),
    };

    const { error: failure } = isCreate
      ? await createFamily({ name: familyName.trim(), ...identity })
      : await joinFamily({ joinCode: code, ...identity });

    if (!isMounted()) return;

    if (failure) {
      setError(errorText(i18n, failure));
      setIsSubmitting(false);
      return;
    }

    // `family_id` now points somewhere, but no guard changes — the user was
    // already in the tabs. Both stores hold a copy of this row, and only after
    // they agree is it safe to leave.
    await Promise.all([refreshProfile(), refresh()]);

    goBack();
  }

  return (
    <Screen edges={['top', 'bottom']} scroll>
      <NavHeader title={t('addFamily.title')} backFallback="/(tabs)/profile" />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Text variant="title" style={styles.heading}>
          {isCreate ? t('addFamily.headingCreate') : t('addFamily.headingJoin')}
        </Text>
        <Text variant="body" color="textSecondary">
          {isCreate ? t('addFamily.subtitleCreate') : t('addFamily.subtitleJoin')}
        </Text>

        <View style={styles.modeRow}>
          <Segmented
            label={t('addFamily.modeLabel')}
            options={modeOptions}
            value={mode}
            onChange={setMode}
            disabled={isSubmitting}
          />
        </View>

        {/*
          The preview is the point of seeding from the profile: it shows the
          member exactly how the family will see them before they commit.
        */}
        <Card style={styles.preview}>
          <Avatar
            initials={initialsFrom(trimmedName)}
            colorIndex={colorIndex}
            avatar={avatar}
            size="lg"
          />

          <View style={styles.previewText}>
            <Text variant="captionStrong" color="textSecondary">
              {t('addFamily.previewLabel')}
            </Text>
            <Text variant="subheading" numberOfLines={1}>
              {trimmedName || unnamedMember(i18n)}
            </Text>
            <Text variant="caption" color="textTertiary">
              {avatar ? t('addFamily.previewMemoji') : t('addFamily.previewInitials')}
            </Text>
          </View>
        </Card>

        <Section title={isCreate ? t('addFamily.sectionFamily') : t('addFamily.sectionCode')}>
          {isCreate ? (
            <TextField
              label={t('addFamily.familyNameLabel')}
              value={familyName}
              onChangeText={setFamilyName}
              placeholder={t('addFamily.familyNamePlaceholder')}
              autoCapitalize="words"
              returnKeyType="next"
              editable={!isSubmitting}
            />
          ) : (
            <View style={styles.codeArea}>
              <CodeInput value={code} onChange={setCode} length={CODE_LENGTH} autoFocus={false} />

              <Text variant="caption" color="textTertiary" center>
                {code.length === CODE_LENGTH
                  ? t('family.codeComplete')
                  : t('family.codeProgress', { typed: code.length, length: CODE_LENGTH })}
              </Text>
            </View>
          )}
        </Section>

        <Section title={t('addFamily.sectionYou')}>
          <View style={styles.form}>
            <TextField
              label={t('addFamily.yourNameLabel')}
              value={displayName}
              onChangeText={setDisplayName}
              placeholder={t('family.yourNamePlaceholder')}
              autoCapitalize="words"
              autoComplete="name"
              maxLength={NAME_MAX}
              returnKeyType="done"
              editable={!isSubmitting}
              error={
                displayName.length > 0 && !isNameValid
                  ? t('addFamily.nameRange', { min: NAME_MIN, max: NAME_MAX })
                  : undefined
              }
            />

            <View style={styles.field}>
              <Text variant="captionStrong" color="textSecondary">
                {t('addFamily.colorLabel')}
              </Text>

              <View style={styles.swatches}>
                {COLOR_CHOICES.map((color, index) => (
                  <PressableScale
                    key={color}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: index === colorIndex, disabled: isSubmitting }}
                    accessibilityLabel={t('family.colorOption', { number: index + 1 })}
                    disabled={isSubmitting}
                    onPress={() => setColorIndex(index)}
                    feedback="select"
                    scaleTo={0.9}
                    style={[
                      styles.swatch,
                      { backgroundColor: color },
                      index === colorIndex && { borderColor: colors.text, borderWidth: 3 },
                    ]}>
                    {index === colorIndex ? (
                      <Ionicons name="checkmark" size={16} color="#FFFFFF" />
                    ) : null}
                  </PressableScale>
                ))}
              </View>

              <Text variant="caption" color="textTertiary">
                {t('addFamily.colorHint')}
              </Text>
            </View>

            <View style={styles.field}>
              <Text variant="captionStrong" color="textSecondary">
                {t('addFamily.roleLabel')}
              </Text>
              <Segmented
                label={t('addFamily.roleLabel')}
                options={roleOptions}
                value={role}
                onChange={setRole}
                disabled={isSubmitting}
              />
              <Text variant="caption" color="textTertiary">
                {t('addFamily.roleHint')}
              </Text>
            </View>
          </View>
        </Section>

        <Card style={styles.note}>
          <Ionicons
            name={error ? 'alert-circle-outline' : 'information-circle-outline'}
            size={20}
            color={error ? colors.danger : colors.accent}
          />
          <Text variant="caption" color={error ? 'danger' : 'textSecondary'} style={styles.flex}>
            {error ?? (isCreate ? t('addFamily.noteCreate') : t('addFamily.noteJoin'))}
          </Text>
        </Card>

        <Button
          label={isCreate ? t('createFamily.submit') : t('joinFamily.submit')}
          disabled={!canSubmit}
          loading={isSubmitting}
          onPress={() => void submit()}
          style={styles.cta}
        />
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  heading: { marginTop: Spacing.lg },
  modeRow: { marginTop: Spacing.xl },
  preview: { flexDirection: 'row', alignItems: 'center', gap: Spacing.lg, marginTop: Spacing.xl },
  previewText: { flex: 1, gap: 2 },
  codeArea: { gap: Spacing.md },
  form: { gap: Spacing.xl },
  field: { gap: Spacing.sm },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md },
  swatch: {
    width: 40,
    height: 40,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  note: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginTop: Spacing.xl },
  cta: { marginTop: Spacing.xl, marginBottom: Spacing.lg },
});
