import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, TextInput, View } from 'react-native';

import { Button, Card, NavHeader, PressableScale, Screen, Text } from '@/components/ui';
import { useAuth } from '@/hooks/useAuth';
import { usePreferences } from '@/hooks/usePreferences';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/hooks/use-translation';
import { createFamily } from '@/services/familyService';
import { errorText } from '@/services/result';
import { MemberColors, Radius, Spacing } from '@/theme';

/** Avatar colour choices offered while creating the family. */
const COLOR_CHOICES = MemberColors.slice(0, 6);

export default function CreateFamilyScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const i18n = useTranslation();
  const { t } = i18n;
  // No navigation on sign-out: clearing the session flips `RootNavigator`'s
  // guards back to the welcome stack, which is what moves the user.
  const { refreshProfile, signOut, user } = useAuth();
  const { setPreference } = usePreferences();

  // All three go in on the `create_family` RPC call, so a family whose creator
  // has no name or colour can never exist. See
  // supabase/migrations/20260804120000_member_identity.sql.
  const [familyName, setFamilyName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [colorIndex, setColorIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const canContinue =
    familyName.trim().length > 1 && displayName.trim().length > 1 && !isCreating;

  // Refreshing the profile is what moves the user on: once `family_id` is set,
  // the root navigator swaps this stack for the tabs.
  async function submit() {
    setIsCreating(true);
    setError(null);

    const { error: failure } = await createFamily({
      name: familyName,
      displayName,
      colorIndex,
      role: 'parent',
    });

    if (failure) {
      setError(errorText(i18n, failure));
      setIsCreating(false);
      return;
    }

    await refreshProfile();
  }

  return (
    <Screen edges={['top', 'bottom']}>
      {/*
        No back control at all: this is the first screen of its `Stack.Protected`
        branch, so nothing is underneath it to pop to — and a chevron that
        dispatches GO_BACK into an unmounted branch reads as a way out while
        doing nothing. Declared rather than left to `canGoBack()`, which is not
        a reliable test of "does this branch have a parent".

        Signing out is what "back" actually means here, and it is the only exit
        that is not forwards, so it takes the trailing action slot.
      */}
      <NavHeader
        title={t('createFamily.title')}
        showBack={false}
        actionLabel={t('common.signOut')}
        actionDisabled={isCreating}
        onActionPress={() => void signOut()}
      />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.flex}>
          <Text variant="title" style={styles.heading}>
            {t('createFamily.heading')}
          </Text>
          <Text variant="body" color="textSecondary">
            {t('createFamily.subtitle')}
          </Text>

          <View style={styles.form}>
            <View style={styles.field}>
              <Text variant="captionStrong" color="textSecondary">
                {t('createFamily.familyNameLabel')}
              </Text>
              <TextInput
                value={familyName}
                onChangeText={setFamilyName}
                placeholder={t('createFamily.familyNamePlaceholder')}
                placeholderTextColor={colors.textTertiary}
                style={[
                  styles.input,
                  { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text },
                ]}
                returnKeyType="next"
              />
            </View>

            <View style={styles.field}>
              <Text variant="captionStrong" color="textSecondary">
                {t('family.yourNameLabel')}
              </Text>
              <TextInput
                value={displayName}
                onChangeText={setDisplayName}
                placeholder={t('family.yourNamePlaceholder')}
                placeholderTextColor={colors.textTertiary}
                style={[
                  styles.input,
                  { backgroundColor: colors.surface, borderColor: colors.border, color: colors.text },
                ]}
                returnKeyType="done"
              />
            </View>

            <View style={styles.field}>
              <Text variant="captionStrong" color="textSecondary">
                {t('family.colorLabel')}
              </Text>
              <View style={styles.swatches}>
                {COLOR_CHOICES.map((color, index) => (
                  <PressableScale
                    key={color}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: index === colorIndex }}
                    accessibilityLabel={t('family.colorOption', { number: index + 1 })}
                    onPress={() => setColorIndex(index)}
                    // Picking your identity colour is a move within a set.
                    feedback="select"
                    // A 40pt circle: the standard dip is lost on something this
                    // small, so it takes the chip's.
                    scaleTo={0.9}
                    style={[
                      styles.swatch,
                      { backgroundColor: color },
                      index === colorIndex && { borderColor: colors.text, borderWidth: 3 },
                    ]}>
                    {index === colorIndex ? <Ionicons name="checkmark" size={16} color="#FFFFFF" /> : null}
                  </PressableScale>
                ))}
              </View>
            </View>
          </View>

          <Card style={styles.note}>
            <Ionicons
              name={error ? 'alert-circle-outline' : 'information-circle-outline'}
              size={20}
              color={error ? colors.danger : colors.accent}
            />
            <Text
              variant="caption"
              color={error ? 'danger' : 'textSecondary'}
              style={styles.flex}>
              {error ?? t('createFamily.note')}
            </Text>
          </Card>

          <PressableScale
            style={styles.altRow}
            accessibilityRole="button"
            feedback="tap"
            scaleTo={0.96}
            hitSlop={8}
            onPress={() => router.replace('/join-family')}>
            <Ionicons name="key-outline" size={18} color={colors.accent} />
            <Text variant="captionStrong" color="accent">
              {t('createFamily.haveCode')}
            </Text>
          </PressableScale>

          {/*
            Ranked below the other two on purpose — secondary text rather than
            accent — because a family is still the point of the app. No
            navigation: setting the preference flips `RootNavigator`'s `inApp`
            guard, the same way creating a family does. Nothing is written to
            the account, so this stays reversible from Profile.
          */}
          <PressableScale
            style={styles.altRow}
            accessibilityRole="button"
            feedback="tap"
            scaleTo={0.96}
            hitSlop={8}
            disabled={isCreating || !user}
            onPress={() => user && setPreference('familySetupSkippedFor', user.id)}>
            <Ionicons name="arrow-forward-outline" size={18} color={colors.textSecondary} />
            <Text variant="captionStrong" color="textSecondary">
              {t('createFamily.skip')}
            </Text>
          </PressableScale>
        </View>

        <Button
          label={t('createFamily.submit')}
          disabled={!canContinue}
          loading={isCreating}
          onPress={submit}
          style={styles.cta}
        />
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  heading: { marginTop: Spacing.lg },
  form: { gap: Spacing.lg, marginTop: Spacing.xl },
  field: { gap: Spacing.sm },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    fontSize: 16,
  },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md },
  swatch: {
    width: 40,
    height: 40,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  note: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginTop: Spacing.xl },
  altRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.xl,
  },
  cta: { marginBottom: Spacing.lg },
});
