import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { CodeInput } from '@/components/family/code-input';
import { Button, Card, NavHeader, PressableScale, Screen, Text } from '@/components/ui';
import { useAuth } from '@/hooks/useAuth';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/hooks/use-translation';
import { joinFamily } from '@/services/familyService';
import { errorText } from '@/services/result';
import { MemberColors, Radius, Spacing } from '@/theme';

const CODE_LENGTH = 6;

/** Avatar colour choices offered while joining — same set as create-family. */
const COLOR_CHOICES = MemberColors.slice(0, 6);

export default function JoinFamilyScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const i18n = useTranslation();
  const { t } = i18n;
  const { refreshProfile, signOut } = useAuth();

  const [code, setCode] = useState('');
  // A joiner needs a name and colour as much as a creator does; without them
  // they land in the tabs as an "Unnamed member" with no screen to fix it.
  const [displayName, setDisplayName] = useState('');
  const [colorIndex, setColorIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isJoining, setIsJoining] = useState(false);

  const isComplete = code.length === CODE_LENGTH;
  const canSubmit = isComplete && displayName.trim().length > 1 && !isJoining;

  // Refreshing the profile is what moves the user on: once `family_id` is set,
  // the root navigator swaps this stack for the tabs.
  async function submit() {
    setIsJoining(true);
    setError(null);

    const { error: failure } = await joinFamily({ joinCode: code, displayName, colorIndex });

    if (failure) {
      setError(errorText(i18n, failure));
      setIsJoining(false);
      return;
    }

    await refreshProfile();
  }

  return (
    <Screen edges={['top', 'bottom']}>
      {/*
        Peer of create-family, reached only by `replace` — never pushed — so
        there is nothing to pop to here either. Moving between the two is the
        explicit "Create a new family instead" link below, not a chevron.
      */}
      <NavHeader
        title={t('joinFamily.title')}
        showBack={false}
        actionLabel={t('common.signOut')}
        actionDisabled={isJoining}
        onActionPress={() => void signOut()}
      />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          style={styles.flex}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled">
          <Text variant="title" style={styles.heading}>
            {t('joinFamily.heading')}
          </Text>
          <Text variant="body" color="textSecondary">
            {t('joinFamily.subtitle')}
          </Text>

          <View style={styles.codeArea}>
            <CodeInput value={code} onChange={setCode} length={CODE_LENGTH} />

            <Text variant="caption" color={error ? 'danger' : 'textTertiary'} center>
              {error ??
                (isComplete
                  ? t('family.codeComplete')
                  : t('family.codeProgress', { typed: code.length, length: CODE_LENGTH }))}
            </Text>
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
                  // Picking your identity colour is a move within a set, on a
                  // circle too small for the standard dip to register.
                  feedback="select"
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

          <Card style={styles.hint}>
            <Ionicons name="bulb-outline" size={20} color={colors.warning} />
            <View style={styles.flex}>
              <Text variant="captionStrong">{t('joinFamily.hintTitle')}</Text>
              <Text variant="caption" color="textSecondary">
                {t('joinFamily.hintBody')}
              </Text>
            </View>
          </Card>

          <PressableScale
            style={styles.scanRow}
            accessibilityRole="button"
            feedback="tap"
            scaleTo={0.96}
            hitSlop={8}
            onPress={() => router.replace('/create-family')}>
            <Ionicons name="add-circle-outline" size={18} color={colors.accent} />
            <Text variant="captionStrong" color="accent">
              {t('joinFamily.createInstead')}
            </Text>
          </PressableScale>
        </ScrollView>

        <Button
          label={t('joinFamily.submit')}
          disabled={!canSubmit}
          loading={isJoining}
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
  codeArea: { gap: Spacing.md, marginTop: Spacing.xl },
  field: { gap: Spacing.sm, marginTop: Spacing.xl },
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
  hint: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginTop: Spacing.xl },
  scanRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.xl,
    marginBottom: Spacing.lg,
  },
  cta: { marginBottom: Spacing.lg },
});
