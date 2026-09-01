import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import type { ColorToken } from '@/theme';

/**
 * The hues that carry a wash. Same four the status tones use, so a component
 * already holding a tone can hand it straight over.
 */
export type GradientTone = Extract<ColorToken, 'primary' | 'warning' | 'danger' | 'info'>;

type GradientSurfaceProps = {
  tone: GradientTone;
  /** Layout, padding and radius — this is the element that lays out. */
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
};

/**
 * A pastel wash for hero surfaces: the status pill, the banner at the top of a
 * tab.
 * https://docs.expo.dev/versions/v57.0.0/sdk/linear-gradient/
 *
 * Both stops are tokens — `${tone}Soft` into `${tone}Wash` — so this adds no
 * colour to the app, only a direction between two that already exist. The wash
 * end sits nearly on the canvas, which is what keeps the effect readable as
 * tinted paper rather than as the gradients the brand rules rule out; anything
 * with two *saturated* stops would be exactly the decoration those forbid.
 *
 * The angle runs diagonally so the tint gathers in one corner. A horizontal
 * sweep on a full-width banner reads as a loading bar.
 */
export function GradientSurface({ tone, style, children }: GradientSurfaceProps) {
  const { colors } = useTheme();

  const stops = [colors[`${tone}Soft` as ColorToken], colors[`${tone}Wash` as ColorToken]] as const;

  return (
    <LinearGradient colors={stops} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={style}>
      {children}
    </LinearGradient>
  );
}
