/**
 * Resolves the active colour scheme into concrete tokens.
 * https://docs.expo.dev/guides/color-schemes/
 */

import { DarkTheme, DefaultTheme, type Theme as NavigationTheme } from '@react-navigation/native';
import { useMemo } from 'react';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { usePreferences } from '@/hooks/usePreferences';
import { Palette, type ThemeColors } from '@/theme';

export type Theme = {
  colors: ThemeColors;
  scheme: 'light' | 'dark';
  isDark: boolean;
};

/**
 * The active scheme is the stored appearance preference, falling back to the
 * OS when it is 'system' (the default). Every themed component in the app calls
 * this, which is what makes flipping the Profile screen's Appearance control
 * repaint the whole tree — including React Navigation's own canvas, via
 * `useNavigationTheme` below.
 */
export function useTheme(): Theme {
  const { preferences } = usePreferences();
  // RN reports 'unspecified' and web reports null pre-hydration; both fall back to light.
  const system = useColorScheme() === 'dark' ? 'dark' : 'light';
  const scheme = preferences.appearance === 'system' ? system : preferences.appearance;

  return useMemo(() => ({ colors: Palette[scheme], scheme, isDark: scheme === 'dark' }), [scheme]);
}

/**
 * React Navigation's own theme, rebuilt from our palette.
 *
 * The navigator paints a full-bleed view behind every screen using
 * `theme.colors.background`, and expo-router's stock themes hardcode
 * `rgb(242, 242, 242)` (light) and `rgb(1, 1, 1)` (dark) — neither is ours, so
 * the canvas read grey no matter what the screens set. Anything not listed here
 * (notably `fonts`) is inherited from the stock theme unchanged.
 */
export function useNavigationTheme(): NavigationTheme {
  const { colors, isDark } = useTheme();

  return useMemo(() => {
    const base = isDark ? DarkTheme : DefaultTheme;

    return {
      ...base,
      colors: {
        ...base.colors,
        primary: colors.primary,
        background: colors.background,
        card: colors.surface,
        text: colors.text,
        border: colors.border,
        notification: colors.danger,
      },
    };
  }, [colors, isDark]);
}
