import { StyleSheet, View } from 'react-native';

import { BatteryBadge } from '@/components/family/battery-badge';
import { Avatar } from '@/components/ui/avatar';
import { Text } from '@/components/ui/text';
import { firstNameOf } from '@/data/format';
import type { FamilyMember } from '@/data/types';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/hooks/use-translation';
import { MemberColors, Radius, Shadow, Spacing } from '@/theme';

/** Widest state of the avatar head: `md` avatar (40) + ring (5) + halo (6), each side. */
const HEAD_SIZE = 62;

/** `label` line height (14) + its own padding and border, plus the gap above it. */
const LABEL_HEIGHT = 19;

const PIN_WIDTH = 96;

const PIN_HEIGHT = HEAD_SIZE + Spacing.xs + LABEL_HEIGHT;

/**
 * Where the pin meets its coordinate: the centre of the avatar, not the centre
 * of the view — the name tag hangs below and would otherwise drag the whole pin
 * up off the place it is marking. The head is a fixed box for exactly this
 * reason, so selecting a member (which thickens the ring and adds the halo)
 * cannot shift the anchor out from under them.
 */
export const MEMBER_PIN_ANCHOR = { x: 0.5, y: HEAD_SIZE / 2 / PIN_HEIGHT };

/**
 * The pin's own box. The native map places the view by `MEMBER_PIN_ANCHOR`
 * alone; the web map has to offset it in pixels, and this is what it multiplies
 * that anchor by. Fixed rather than measured so a pin is never drawn at the
 * wrong place for one frame while a layout pass catches up.
 */
export const MEMBER_PIN_SIZE = { width: PIN_WIDTH, height: PIN_HEIGHT };

type MemberPinProps = {
  member: FamilyMember;
  selected?: boolean;
};

/**
 * The marker content for one member.
 *
 * Purely presentational: it draws, and says nothing about where. The native map
 * hands it to a `<Marker coordinate={…}>` and the web map positions it against
 * the tile grid, so press handling and the accessibility label belong to
 * whichever of those is holding it — a `Pressable` in here would be a second
 * touch target inside the marker's own.
 */
export function MemberPin({ member, selected }: MemberPinProps) {
  const { colors } = useTheme();
  const i18n = useTranslation();

  /**
   * The member's identity colour, the same one their activity dot and their
   * initials fallback take. It rings the avatar rather than sitting behind it:
   * a loaded memoji brings its own circular background, and painting under it
   * would show a mismatched halo wherever the two circles disagree. A member
   * with a memoji would otherwise carry no identity colour on the map at all.
   */
  const memberColor = MemberColors[member.colorIndex % MemberColors.length];

  return (
    <View style={styles.pin}>
      {/*
        Centring on someone from the drawer adds a second, wider ring in their
        own colour rather than recolouring the first: the colour identifies the
        member, so it has to survive being picked, and a concentric halo reads
        as "this one" from across the map.
      */}
      <View style={styles.head}>
        <View style={selected ? [styles.halo, { borderColor: memberColor }] : undefined}>
          <View
            style={[
              styles.avatarRing,
              selected && styles.avatarRingSelected,
              { borderColor: memberColor, backgroundColor: colors.surface },
            ]}>
            <Avatar
              initials={member.initials}
              colorIndex={member.colorIndex}
              avatar={member.avatar}
              size="md"
              online={member.presence === 'online'}
            />
          </View>
        </View>
      </View>

      <View
        style={[
          styles.label,
          { backgroundColor: colors.surface, borderColor: selected ? memberColor : colors.border },
        ]}>
        {/* Shrinks rather than pushes: the tag is capped at `PIN_WIDTH`, so a
            long first name has to give way to the badge instead of squeezing
            it out of the box. */}
        <Text variant="label" numberOfLines={1} style={styles.name}>
          {firstNameOf(i18n, member.displayName)}
        </Text>

        {/*
          Inside the name tag rather than under it, and that is geometry as much
          as taste: `MEMBER_PIN_SIZE` is a fixed box the web map multiplies the
          anchor by, so a badge on its own line would move every pin off the
          coordinate it marks. `inline` drops the chip's own fill, because a
          pill inside this pill would read as two labels.

          `presence === 'online'` is the whole gate, and it lives here at the
          call site on purpose — see `BatteryBadge`. A charge level is only ever
          as fresh as the position it was written with, and a pin that has not
          been restamped in an hour must not carry a number that looks current.
        */}
        {member.presence === 'online' && member.location ? (
          <BatteryBadge
            level={member.location.batteryLevel}
            isCharging={member.location.isCharging}
            variant="inline"
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pin: { alignItems: 'center', width: PIN_WIDTH, height: PIN_HEIGHT },
  // Fixed box so the halo grows inside it rather than moving the anchor.
  head: { width: HEAD_SIZE, height: HEAD_SIZE, alignItems: 'center', justifyContent: 'center' },
  avatarRing: { padding: 3, borderRadius: Radius.pill, borderWidth: 2, ...Shadow.floating },
  // Selection thickens the ring rather than recolouring it — the colour is the
  // member's identity and has to survive being tapped.
  avatarRingSelected: { borderWidth: 3 },
  halo: { padding: 4, borderRadius: Radius.pill, borderWidth: 2 },
  name: { flexShrink: 1 },
  label: {
    // A row, because the name tag now carries the battery badge beside the
    // name — see the note at the call site. The height is unchanged, which is
    // what keeps `MEMBER_PIN_ANCHOR` pointing at the same place.
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginTop: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: PIN_WIDTH,
  },
});
