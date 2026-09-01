/**
 * Re-rolling an avatar, reached from the Profile tab.
 *
 * Same picker as onboarding; the difference is only what saving means. Here the
 * member already has a family and a memoji, so no guard flips — this screen is
 * pushed and pops itself. It exists because onboarding's "Skip" would otherwise
 * be a one-way door onto a memoji nobody picked.
 */

import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { MemojiPicker } from '@/components/family/memoji-picker';
import { Button, Card, NavHeader, Screen, Text } from '@/components/ui';
import { parseAvatarConfig, randomAvatarSeed } from '@/data/avatar';
import { useAuth } from '@/hooks/useAuth';
import { useFamily } from '@/hooks/useFamily';
import { useIsMounted, useSafeBack } from '@/hooks/use-safe-back';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/hooks/use-translation';
import { updateOwnProfile } from '@/services/familyService';
import { errorText } from '@/services/result';
import { Spacing } from '@/theme';

export default function EditAvatarScreen() {
  const { colors } = useTheme();
  const i18n = useTranslation();
  const { t } = i18n;
  const { profile, refreshProfile } = useAuth();
  const { refresh } = useFamily();
  const goBack = useSafeBack('/(tabs)/profile');
  const isMounted = useIsMounted();

  // Opens on the memoji they already have, so "Save" without shuffling is a
  // no-op rather than a surprise.
  const [seed, setSeed] = useState(
    () => parseAvatarConfig(profile?.avatar_config)?.seed ?? randomAvatarSeed(),
  );
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function save() {
    setIsSaving(true);
    setError(null);

    const { error: failure } = await updateOwnProfile({ avatar: { seed } });

    if (!isMounted()) return;

    if (failure) {
      setError(errorText(i18n, failure));
      setIsSaving(false);
      return;
    }

    // Both stores hold a copy of this row: the profile drives the guards, the
    // family list drives every avatar the tabs render.
    await Promise.all([refresh(), refreshProfile()]);

    // Guarded for the same reason as the write above: the user may have gone
    // back while those two round trips were in flight.
    goBack();
  }

  return (
    <Screen edges={['top', 'bottom']} scroll>
      <NavHeader title={t('editAvatar.title')} backFallback="/(tabs)/profile" />

      <View style={styles.picker}>
        <MemojiPicker seed={seed} onChange={setSeed} disabled={isSaving} />
      </View>

      {error ? (
        <Card style={styles.note}>
          <Ionicons name="alert-circle-outline" size={20} color={colors.danger} />
          <Text variant="caption" color="danger" style={styles.flex}>
            {error}
          </Text>
        </Card>
      ) : null}

      <Button
        label={t('avatarBuilder.save')}
        loading={isSaving}
        disabled={isSaving}
        onPress={() => void save()}
        style={styles.cta}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  picker: { marginTop: Spacing.xxl, marginBottom: Spacing.xxl },
  note: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginBottom: Spacing.lg },
  cta: { marginTop: 'auto', marginBottom: Spacing.lg },
});
