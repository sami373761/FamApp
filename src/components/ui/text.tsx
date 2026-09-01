import { StyleSheet, Text as RNText, type TextProps } from 'react-native';

import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/hooks/use-translation';
import { Typography, type ColorToken, type TypographyVariant } from '@/theme';

export type AppTextProps = TextProps & {
  variant?: TypographyVariant;
  /** Any colour token; defaults to primary body text. */
  color?: ColorToken;
  center?: boolean;
};

/**
 * Themed text primitive. Every string in the app should go through this so
 * colour and type scale stay centralised.
 *
 * It is also where right-to-left is handled, and the only place: an RTL
 * language gets `writingDirection: 'rtl'` and right-aligned text, which is what
 * puts trailing punctuation and embedded Latin runs (an email address, a join
 * code) on the correct side. The *layout* is deliberately not mirrored —
 * `I18nManager.forceRTL` only takes effect after a relaunch, and a language
 * picker that needs the app restarted to finish the job is worse than one that
 * leaves the columns where they are. `center` still wins, since a caller that
 * asked for centred text meant it in any script.
 */
export function Text({
  variant = 'body',
  color = 'text',
  center,
  style,
  ...rest
}: AppTextProps) {
  const { colors } = useTheme();
  const { isRTL } = useTranslation();

  return (
    <RNText
      style={[
        Typography[variant],
        { color: colors[color] },
        isRTL && styles.rtl,
        center && styles.center,
        style,
      ]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  center: { textAlign: 'center' },
  rtl: { writingDirection: 'rtl', textAlign: 'right' },
});
