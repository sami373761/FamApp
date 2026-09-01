import { Platform, type TextStyle } from 'react-native';

/**
 * Type scale. Each variant pairs a size with an explicit lineHeight so vertical
 * rhythm holds when text wraps — RN does not derive one for you.
 */

export const FontFamily = Platform.select({
  ios: { sans: 'system-ui', rounded: 'ui-rounded', mono: 'ui-monospace' },
  android: { sans: 'sans-serif', rounded: 'sans-serif', mono: 'monospace' },
  default: { sans: 'System', rounded: 'System', mono: 'monospace' },
}) as { sans: string; rounded: string; mono: string };

export const Typography = {
  display: { fontSize: 34, lineHeight: 41, fontWeight: '700' },
  title: { fontSize: 28, lineHeight: 34, fontWeight: '700' },
  heading: { fontSize: 20, lineHeight: 26, fontWeight: '700' },
  subheading: { fontSize: 17, lineHeight: 23, fontWeight: '600' },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400' },
  bodyStrong: { fontSize: 15, lineHeight: 22, fontWeight: '600' },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  captionStrong: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  label: { fontSize: 11, lineHeight: 14, fontWeight: '600' },
} satisfies Record<string, TextStyle>;

export type TypographyVariant = keyof typeof Typography;
