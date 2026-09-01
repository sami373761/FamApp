import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { avatarImageUrl, type AvatarConfig } from '@/data/avatar';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/hooks/use-translation';
import { MemberColors, Radius, type TypographyVariant } from '@/theme';

export type AvatarSize = 'sm' | 'md' | 'lg' | 'xl';

type AvatarProps = {
  initials: string;
  /** Index into `MemberColors`; wraps so any number is safe. */
  colorIndex: number;
  /**
   * The member's chosen memoji. Null when `profiles.avatar_config` is still the
   * `{}` default — that member simply has not been through the picker yet.
   */
  avatar?: AvatarConfig | null;
  size?: AvatarSize;
  /** Draws a small status dot in the bottom-right corner. */
  online?: boolean;
  /**
   * Draws a ring around the circle. The caller decides what earns one — every
   * caller in the app passes `isRecentlySynced(member.location)`, i.e. the
   * member's device has written a position within one tracking interval, so
   * their app is live rather than merely their pin being fresh.
   */
  ring?: boolean;
};

const DIMENSIONS: Record<AvatarSize, number> = { sm: 32, md: 40, lg: 56, xl: 88 };
const TEXT_VARIANT: Record<AvatarSize, TypographyVariant> = {
  sm: 'label',
  md: 'captionStrong',
  lg: 'subheading',
  xl: 'title',
};

/**
 * A member's avatar: their Tapback memoji when they have one, their initials on
 * the member colour otherwise.
 *
 * The initials are a real fallback rather than decoration. They hold the circle
 * while the memoji is in flight and keep it for good if the request fails, so a
 * family with no signal still sees who is who — this is the only network image
 * in the app, and it is not allowed to leave a hole.
 */
export function Avatar({ initials, colorIndex, avatar, size = 'md', online, ring }: AvatarProps) {
  const { colors } = useTheme();
  const dimension = DIMENSIONS[size];

  return (
    <View
      style={
        ring ? [styles.ring, { borderColor: colors.success, borderRadius: Radius.pill }] : undefined
      }>
      {/*
        Keyed on the seed so that picking a new memoji remounts the image and
        clears whatever load state the previous one ended in.
      */}
      <AvatarBody
        key={avatar?.seed ?? 'initials'}
        initials={initials}
        colorIndex={colorIndex}
        seed={avatar?.seed}
        dimension={dimension}
        textVariant={TEXT_VARIANT[size]}
      />

      {online ? (
        <View
          style={[
            styles.dot,
            {
              backgroundColor: colors.success,
              borderColor: colors.surface,
              width: dimension / 4,
              height: dimension / 4,
              borderRadius: dimension / 8,
            },
          ]}
        />
      ) : null}
    </View>
  );
}

/**
 * The circle itself. Split out so its load state is scoped to one seed.
 *
 * The memoji ships its own circular background — the seed picks that colour
 * too — so once it has loaded nothing is drawn behind it. Leaving the member
 * colour there would ring the memoji wherever the two circles fail to line up
 * exactly.
 */
function AvatarBody({
  initials,
  colorIndex,
  seed,
  dimension,
  textVariant,
}: {
  initials: string;
  colorIndex: number;
  seed?: string;
  dimension: number;
  textVariant: TypographyVariant;
}) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<'pending' | 'loaded' | 'failed'>('pending');

  const showImage = !!seed && status !== 'failed';
  const showInitials = !showImage || status !== 'loaded';

  return (
    <View
      style={[
        styles.avatar,
        { width: dimension, height: dimension, borderRadius: dimension / 2 },
        showInitials && { backgroundColor: MemberColors[colorIndex % MemberColors.length] },
      ]}>
      {showInitials ? (
        <Text variant={textVariant} style={styles.initials}>
          {initials}
        </Text>
      ) : null}

      {showImage && seed ? (
        <Image
          source={avatarImageUrl(seed)}
          style={styles.image}
          contentFit="cover"
          // The same faces recur on every tab; the disk cache is what keeps
          // scrolling a chat from re-fetching them.
          cachePolicy="memory-disk"
          transition={120}
          accessibilityLabel={t('avatar.a11y', { initials })}
          onLoad={() => setStatus('loaded')}
          onError={() => setStatus('failed')}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  // RN 0.81: `absoluteFill` is a registered style ID; `absoluteFillObject` is the spreadable one.
  image: { ...StyleSheet.absoluteFillObject },
  // Always white: member colours are chosen to carry white text in both schemes.
  initials: { color: '#FFFFFF' },
  // A gap between ring and memoji, so the ring reads as a state around the face
  // rather than as a border on it.
  ring: { padding: 2, borderWidth: 2 },
  dot: { position: 'absolute', right: 0, bottom: 0, borderWidth: 2 },
});
