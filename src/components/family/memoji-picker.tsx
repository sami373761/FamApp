/**
 * The memoji shuffler, shared by the onboarding step and the "Edit avatar"
 * screen so the two can never drift apart.
 *
 * Controlled: it holds no seed of its own, renders the one it is given and
 * reports the next. Whoever owns the state decides what saving means.
 *
 * The next seed is generated and prefetched *before* the user asks for it, so
 * shuffling swaps to an image that is already in the cache instead of blanking
 * the circle for a round trip. That is the whole reason the queued seed is
 * state rather than something `shuffle()` invents on the spot.
 */

import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { PressableScale } from '@/components/ui/pressable-scale';
import { Text } from '@/components/ui/text';
import { avatarImageUrl, randomAvatarSeed } from '@/data/avatar';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/hooks/use-translation';
import { Radius, Shadow, Spacing } from '@/theme';

type MemojiPickerProps = {
  seed: string;
  onChange: (seed: string) => void;
  /** Blocks shuffling while a save is in flight. */
  disabled?: boolean;
};

const PREVIEW_SIZE = 200;

export function MemojiPicker({ seed, onChange, disabled = false }: MemojiPickerProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [queued, setQueued] = useState(randomAvatarSeed);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    // Fire and forget: a failed warm-up just means the next tap waits for the
    // network like any other image would.
    void Image.prefetch(avatarImageUrl(queued), { cachePolicy: 'memory-disk' });
  }, [queued]);

  function shuffle() {
    onChange(queued);
    setQueued(randomAvatarSeed());
    setFailed(false);
  }

  return (
    <View style={styles.root}>
      <View
        style={[
          styles.frame,
          { backgroundColor: colors.surfaceMuted, borderColor: colors.border },
        ]}>
        {failed ? (
          <View style={styles.offline}>
            <Ionicons name="cloud-offline-outline" size={32} color={colors.textTertiary} />
            <Text variant="caption" color="textTertiary" center>
              {t('memoji.failed')}
            </Text>
          </View>
        ) : (
          <Image
            key={seed}
            source={avatarImageUrl(seed)}
            style={styles.image}
            contentFit="contain"
            cachePolicy="memory-disk"
            transition={160}
            accessibilityLabel={t('memoji.imageA11y')}
            onError={() => setFailed(true)}
          />
        )}
      </View>

      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={t('memoji.shuffleA11y')}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={shuffle}
        // Shuffling walks a set of seeds, so each press is a selection.
        feedback="select"
        style={[
          styles.shuffle,
          { backgroundColor: colors.surface, borderColor: colors.border },
          disabled && styles.dimmed,
        ]}>
        <Ionicons name="shuffle" size={18} color={colors.accent} />
        <Text variant="captionStrong" color="accent">
          {t('memoji.shuffle')}
        </Text>
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', gap: Spacing.lg },
  frame: {
    width: PREVIEW_SIZE,
    height: PREVIEW_SIZE,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    ...Shadow.card,
  },
  image: { width: '100%', height: '100%' },
  offline: { alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.lg },
  shuffle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  dimmed: { opacity: 0.7 },
});
