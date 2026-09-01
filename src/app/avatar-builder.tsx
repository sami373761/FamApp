/**
 * Avatar onboarding — the step after the name and family details.
 *
 * Mounted by `RootNavigator` for a signed-in user who is past family setup —
 * either in a family or having skipped it — but has no usable `avatar_config`,
 * which means writing one is what moves them into the tabs: there is no
 * `router.replace` here, only a save and a `refreshProfile()`. Nothing here
 * touches the family, so it works the same for a member of one and for someone
 * on their own; `refresh()` is a no-op in the latter case.
 *
 * "Skip" is a real write, not a bypass. It stores the memoji that was on screen
 * when the member arrived — the one nobody chose — so a skipper is
 * indistinguishable from someone who kept the first roll and never sees this
 * screen again. Leaving the column empty would put them back here on every cold
 * start.
 */

import { Ionicons } from '@expo/vector-icons';
import { useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { MemojiPicker } from '@/components/family/memoji-picker';
import { Button, Card, NavHeader, Screen, Text } from '@/components/ui';
import { randomAvatarSeed } from '@/data/avatar';
import { useAuth } from '@/hooks/useAuth';
import { useFamily } from '@/hooks/useFamily';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/hooks/use-translation';
import { updateOwnProfile } from '@/services/familyService';
import { errorText } from '@/services/result';
import { Spacing } from '@/theme';

export default function AvatarBuilderScreen() {
  const { colors } = useTheme();
  const i18n = useTranslation();
  const { t } = i18n;
  const { refreshProfile } = useAuth();
  const { refresh } = useFamily();

  const [seed, setSeed] = useState(randomAvatarSeed);
  // Captured from the first render: what "Skip" means is the memoji the member
  // was shown, not wherever they happened to stop shuffling.
  const initialSeed = useRef(seed).current;

  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<'save' | 'skip' | null>(null);

  async function commit(chosen: string, mode: 'save' | 'skip') {
    setPending(mode);
    setError(null);

    const { error: failure } = await updateOwnProfile({ avatar: { seed: chosen } });

    if (failure) {
      setError(errorText(i18n, failure));
      setPending(null);
      return;
    }

    // The family loaded while this member still had no avatar; refreshing first
    // means the tabs open showing the memoji rather than the old initials.
    await refresh();
    await refreshProfile();
  }

  return (
    <Screen edges={['top', 'bottom']} scroll>
      <NavHeader
        title={t('avatarBuilder.title')}
        showBack={false}
        actionLabel={t('common.skip')}
        actionDisabled={pending !== null}
        onActionPress={() => void commit(initialSeed, 'skip')}
      />

      <Text variant="title" style={styles.heading}>
        {t('avatarBuilder.heading')}
      </Text>
      <Text variant="body" color="textSecondary">
        {t('avatarBuilder.subtitle')}
      </Text>

      <View style={styles.picker}>
        <MemojiPicker seed={seed} onChange={setSeed} disabled={pending !== null} />
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
        loading={pending === 'save'}
        disabled={pending !== null}
        onPress={() => void commit(seed, 'save')}
        style={styles.cta}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  heading: { marginTop: Spacing.lg },
  picker: { marginTop: Spacing.xxl, marginBottom: Spacing.xxl },
  note: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginBottom: Spacing.lg },
  cta: { marginTop: 'auto', marginBottom: Spacing.lg },
});
