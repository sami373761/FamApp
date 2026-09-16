import { useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/hooks/use-translation';
import { Radius, Spacing } from '@/theme';

type CodeInputProps = {
  value: string;
  onChange: (next: string) => void;
  length?: number;
  autoFocus?: boolean;
};

/**
 * Segmented code entry.
 *
 * A single transparent TextInput sits on top of the boxes and captures all
 * input — this keeps caret handling, paste and backspace behaving natively,
 * which per-box inputs notoriously get wrong.
 */
export function CodeInput({ value, onChange, length = 6, autoFocus = true }: CodeInputProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const inputRef = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);

  const characters = Array.from({ length }, (_, index) => value[index] ?? '');
  // The active box is the first empty one, clamped to the last box when full.
  const activeIndex = Math.min(value.length, length - 1);

  const handleChange = (raw: string) => {
    // Codes are uppercase alphanumeric; strip anything else (including pasted spaces).
    const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, length);
    onChange(cleaned);
  };

  return (
    <Pressable
      accessibilityRole="none"
      onPress={() => inputRef.current?.focus()}
      style={styles.wrapper}>
      <View style={styles.boxes}>
        {characters.map((char, index) => {
          const isActive = focused && index === activeIndex;

          return (
            <View
              key={index}
              style={[
                styles.box,
                {
                  backgroundColor: colors.surface,
                  borderColor: isActive ? colors.primary : colors.border,
                  borderWidth: isActive ? 2 : StyleSheet.hairlineWidth,
                },
              ]}>
              <Text variant="title">{char}</Text>
            </View>
          );
        })}
      </View>

      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={handleChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        autoFocus={autoFocus}
        maxLength={length}
        autoCapitalize="characters"
        autoCorrect={false}
        autoComplete="one-time-code"
        keyboardType={Platform.OS === 'ios' ? 'ascii-capable' : 'visible-password'}
        style={styles.hiddenInput}
        // Keeps the caret invisible on platforms that would otherwise paint it.
        caretHidden
        accessibilityLabel={t('family.codeInputA11y', { length })}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrapper: { position: 'relative' },
  boxes: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.sm },
  box: {
    flex: 1,
    aspectRatio: 0.82,
    maxWidth: 56,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hiddenInput: {
    ...StyleSheet.absoluteFill,
    opacity: 0,
    // Android ignores taps on a zero-opacity input without an explicit size.
    width: '100%',
    height: '100%',
    color: 'transparent',
  },
});
