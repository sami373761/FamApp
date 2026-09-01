import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/text';
import type { PlaceCategory } from '@/data/types';
import { useTheme } from '@/hooks/use-theme';
import { Radius, Shadow, Spacing } from '@/theme';

/**
 * One glyph per category, and the reason `PlaceCategory` is a closed set: a
 * value with no icon would reach the map as a blank marker. Exported because
 * Home's status pill draws the same glyph for the same place — the icon is part
 * of what a category *is*, not decoration this file happens to pick.
 */
export const PLACE_ICONS: Record<PlaceCategory, keyof typeof Ionicons.glyphMap> = {
  home: 'home',
  school: 'school',
  work: 'briefcase',
  leisure: 'cafe',
  park: 'leaf',
};

/** Diameter of the marker disc; the tail and the label hang below it. */
const DISC_SIZE = 34;

const TAIL_HEIGHT = 6;

const LABEL_HEIGHT = 19;

const PIN_WIDTH = 110;

const PIN_HEIGHT = DISC_SIZE + TAIL_HEIGHT + Spacing.xs + LABEL_HEIGHT;

/**
 * A place pin points *at* its coordinate rather than sitting on it: the tip of
 * the tail is the anchor, which is what makes two places a few metres apart
 * still read as two distinct spots. Fixed rather than measured, for the same
 * reason `MEMBER_PIN_ANCHOR` is — a pin drawn at the wrong place for one frame
 * is a pin that jumps.
 */
export const PLACE_PIN_ANCHOR = { x: 0.5, y: (DISC_SIZE + TAIL_HEIGHT) / PIN_HEIGHT };

/** What the web map multiplies the anchor by to offset the pin in pixels. */
export const PLACE_PIN_SIZE = { width: PIN_WIDTH, height: PIN_HEIGHT };

type PlacePinProps = {
  /**
   * Omitted only by a draft, which has no category until the composer is filled
   * in — it draws a neutral marker rather than guessing at one of the five.
   */
  category?: PlaceCategory;
  /** Omitted while the pin is still a draft with nothing to be called. */
  title?: string;
  selected?: boolean;
  /**
   * The pin the composer is placing, before there is a row behind it. Drawn
   * hollow so it cannot be mistaken for something already saved.
   */
  draft?: boolean;
};

/**
 * The marker content for one saved place.
 *
 * Presentational only, exactly like `MemberPin`: the native map hands it to a
 * `<Marker coordinate={…}>` and the web map positions it against the tile grid,
 * so the touch target belongs to whichever of those is holding it.
 *
 * It is deliberately a different shape from a member pin — a tailed disc rather
 * than a face — because the two answer different questions. A member moves; a
 * place does not, and the map should not need a second look to tell them apart.
 */
export function PlacePin({ category, title, selected, draft }: PlacePinProps) {
  const { colors } = useTheme();

  // A draft is the accent, not the brand green: it is a proposal, and the
  // filled-primary vocabulary belongs to things that have actually been saved.
  const tone = draft ? colors.accent : colors.primary;

  return (
    <View style={styles.pin}>
      <View
        style={[
          styles.disc,
          {
            backgroundColor: draft ? colors.surface : tone,
            borderColor: tone,
          },
          selected && styles.discSelected,
        ]}>
        <Ionicons
          name={category ? PLACE_ICONS[category] : 'location'}
          size={18}
          color={draft ? tone : colors.onPrimary}
        />
      </View>

      {/* The tail is a rotated square with two corners rounded off — a triangle
          would need a border trick that renders differently on web. */}
      <View style={[styles.tail, { backgroundColor: tone }]} />

      {title ? (
        <View
          style={[
            styles.label,
            { backgroundColor: colors.surface, borderColor: selected ? tone : colors.border },
          ]}>
          <Text variant="label" numberOfLines={1}>
            {title}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  pin: { alignItems: 'center', width: PIN_WIDTH, height: PIN_HEIGHT },
  disc: {
    width: DISC_SIZE,
    height: DISC_SIZE,
    borderRadius: Radius.pill,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadow.floating,
  },
  // Selection thickens the ring rather than recolouring it, the same way a
  // member pin's does.
  discSelected: { borderWidth: 4 },
  tail: {
    width: 10,
    height: 10,
    marginTop: -5,
    borderBottomLeftRadius: 2,
    transform: [{ rotate: '45deg' }],
  },
  label: {
    marginTop: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: PIN_WIDTH,
  },
});
