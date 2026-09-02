/**
 * How much charge a member's phone had when it last wrote its position.
 *
 * **It is the caller's job to decide whether this may be shown at all**, and
 * the rule is one line: only for a member whose `presence` is `'online'`. This
 * component does not check it, and deliberately does not take the member —
 * giving it a `FamilyMember` would let it look presence up itself and make the
 * rule invisible at every call site, which is exactly where it needs to be
 * legible. The number ages with the row it rides on (`LocationContext` writes
 * it beside a position, never on its own), so a badge on an hour-old pin would
 * read as current and be wrong, and that is the one way this feature can lie.
 *
 * A null level renders nothing rather than a dash or a "?" — the member has
 * switched battery sharing off, or their device has no battery API, and both
 * mean there is nothing to say. `isCharging` is separately nullable and is
 * treated as "unknown, so no bolt": a phone whose state the OS would not report
 * still has a percentage worth showing.
 *
 * The tone is the whole of its urgency vocabulary and it is the palette's
 * existing three, not a new colour: `danger` at or under 15%, `warning` at or
 * under 30%, `textTertiary` above that. Charging drops the tone entirely and
 * goes `success` — a phone on 8% that is plugged in is not a problem, and
 * showing it in red would be the badge disagreeing with the bolt beside it.
 */

import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/hooks/use-translation';
import { Radius, Spacing, type ColorToken } from '@/theme';

/** At or below this, the badge is red. */
const CRITICAL_PERCENT = 15;
/** At or below this, amber. */
const LOW_PERCENT = 30;

type BatteryBadgeProps = {
  /** 0–100, or null — which renders nothing at all. */
  level: number | null;
  /** Null is "unknown", and draws no bolt rather than claiming unplugged. */
  isCharging?: boolean | null;
  /**
   * `pill` is the standalone chip Home's presence strip uses; `inline` drops
   * the fill and the padding for somewhere that already has a surface of its
   * own — the map pin's name tag, where a second pill inside a pill would read
   * as two labels.
   */
  variant?: 'pill' | 'inline';
};

/** Which of the palette's three the percentage falls into. */
function toneFor(level: number, isCharging: boolean | null | undefined): ColorToken {
  if (isCharging) return 'success';
  if (level <= CRITICAL_PERCENT) return 'danger';
  if (level <= LOW_PERCENT) return 'warning';

  return 'textTertiary';
}

/**
 * The glyph is the level, not decoration: Ionicons ships four battery states
 * and using the right one means the badge is still readable to somebody who
 * cannot distinguish the three tones above.
 */
function iconFor(level: number, isCharging: boolean | null | undefined) {
  if (isCharging) return 'battery-charging' as const;
  if (level <= CRITICAL_PERCENT) return 'battery-dead' as const;
  if (level >= 95) return 'battery-full' as const;

  return 'battery-half' as const;
}

export function BatteryBadge({ level, isCharging = null, variant = 'pill' }: BatteryBadgeProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();

  // Nothing to say, so nothing is drawn — see the note above on why null is an
  // answer here rather than a gap to fill with a placeholder.
  if (level === null) return null;

  const tone = toneFor(level, isCharging);

  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={
        isCharging
          ? t('battery.a11yCharging', { percent: level })
          : t('battery.a11y', { percent: level })
      }
      style={[
        styles.badge,
        variant === 'pill' && [styles.pill, { backgroundColor: colors.surfaceMuted }],
      ]}>
      <Ionicons name={iconFor(level, isCharging)} size={12} color={colors[tone]} />
      <Text variant="label" color={tone}>
        {t('battery.percent', { percent: level })}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  pill: {
    paddingHorizontal: Spacing.xs,
    paddingVertical: 1,
    borderRadius: Radius.pill,
  },
});
