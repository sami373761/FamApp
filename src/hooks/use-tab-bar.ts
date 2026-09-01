/**
 * Where the floating tab bar sits, and how much room a screen owes it.
 *
 * The bar is `position: 'absolute'`, so the tab navigator reserves no space for
 * it: a scroll view runs the full height of the screen and its last row would
 * otherwise finish underneath the pill. Both the bar itself and every tab screen
 * read these numbers, so the offset the bar is drawn at and the padding content
 * keeps clear of it can never drift apart.
 */

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TabBar } from '@/theme';

export type TabBarMetrics = {
  height: number;
  /** Distance from the bottom of the window to the bottom of the bar. */
  offset: number;
  /** Bottom padding a scrolling tab screen needs so nothing hides behind it. */
  clearance: number;
};

export function useTabBarMetrics(): TabBarMetrics {
  const insets = useSafeAreaInsets();

  // On a device with a home indicator the inset already clears it; on one
  // without, the gap keeps the pill off the very edge of the glass.
  const offset = Math.max(insets.bottom, TabBar.gap);

  return {
    height: TabBar.height,
    offset,
    clearance: offset + TabBar.height + TabBar.gap,
  };
}
