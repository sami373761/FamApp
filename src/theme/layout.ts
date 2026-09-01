/**
 * Spacing, radii and elevation tokens.
 *
 * Spacing follows a 4pt grid — use these instead of raw numbers so rhythm stays
 * consistent as screens are added.
 */

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

/**
 * Corner radii, and they are a hierarchy rather than four sizes to pick from.
 * How far a surface is from the page decides which it takes:
 *
 * | token | what wears it |
 * | --- | --- |
 * | `sm`  | a well inside something else — an icon tile, a segment's thumb |
 * | `md`  | a control: a button, a field, a menu row |
 * | `lg`  | a card — the grouped block that sits on the page |
 * | `xl`  | a surface that floats *above* the page: a sheet, a dialog, the map
 *           drawer, and the two washed banners that head a tab |
 * | `pill`| anything whose shape is its meaning: an avatar, a badge, a FAB |
 *
 * A dialog is not a card with a bigger corner; it is further away, and the
 * corner is how the eye is told. Reach for the row that matches the surface
 * before adding a value.
 */
export const Radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
} as const;

/**
 * Cross-platform elevation. iOS reads the shadow* props while Android only
 * honours `elevation`, so both are set together.
 */
export const Shadow = {
  // Carries card definition now that light-mode cards are white on white.
  card: {
    shadowColor: '#1D1F1F',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 1,
  },
  floating: {
    shadowColor: '#1D1F1F',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 6,
  },
} as const;

/** Caps line length on tablets / web so content does not stretch edge to edge. */
export const MaxContentWidth = 600;

/**
 * The floating tab bar's own metrics.
 *
 * The bar is detached from the bottom edge, so it no longer takes layout space
 * out of a screen — content scrolls *under* it. Every tab screen therefore has
 * to reserve the room back, and it must be the same number in both places or a
 * list ends underneath the pill. `useTabBarMetrics()` is that one number.
 */
export const TabBar = {
  height: 64,
  /** Inset from the screen edge, and the breathing room kept above the bar. */
  gap: Spacing.lg,
} as const;
