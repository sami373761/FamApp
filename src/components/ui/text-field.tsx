import { useState } from 'react';
import { StyleSheet, TextInput, View, type KeyboardTypeOptions, type ViewStyle } from 'react-native';

import { Text } from '@/components/ui/text';
import { useTheme } from '@/hooks/use-theme';
import { Radius, Spacing } from '@/theme';

type TextFieldProps = {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  /** Renders below the field and turns the border red. */
  error?: string;
  secureTextEntry?: boolean;
  keyboardType?: Extract<KeyboardTypeOptions, 'default' | 'email-address' | 'number-pad'>;
  autoCapitalize?: 'none' | 'words';
  /** Drives password managers and OS autofill. */
  autoComplete?: 'email' | 'password' | 'new-password' | 'name' | 'one-time-code' | 'off';
  returnKeyType?: 'next' | 'done' | 'go';
  onSubmitEditing?: () => void;
  editable?: boolean;
  /** Grows to a few lines for free-text entry, then scrolls internally. */
  multiline?: boolean;
  /** Hard cap enforced by the field itself, for a column with a length check. */
  maxLength?: number;
  style?: ViewStyle;
};

export function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  error,
  secureTextEntry = false,
  keyboardType = 'default',
  autoCapitalize = 'none',
  autoComplete = 'off',
  returnKeyType,
  onSubmitEditing,
  editable = true,
  multiline = false,
  maxLength,
  style,
}: TextFieldProps) {
  const { colors } = useTheme();
  const [isFocused, setIsFocused] = useState(false);

  // The light canvas is white, so a field separates itself by line, not fill.
  const borderColor = error ? colors.danger : isFocused ? colors.primary : colors.border;

  return (
    <View style={[styles.field, style]}>
      <Text variant="captionStrong" color="textSecondary">
        {label.toUpperCase()}
      </Text>

      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textTertiary}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoComplete={autoComplete}
        autoCorrect={false}
        returnKeyType={returnKeyType}
        onSubmitEditing={onSubmitEditing}
        editable={editable}
        multiline={multiline}
        maxLength={maxLength}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        accessibilityLabel={label}
        style={[
          styles.input,
          multiline && styles.multiline,
          {
            backgroundColor: editable ? colors.surface : colors.surfaceMuted,
            borderColor,
            color: colors.text,
          },
        ]}
      />

      {error ? (
        <Text variant="caption" color="danger">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: Spacing.sm },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    fontSize: 16,
  },
  // Roughly three lines before the field scrolls rather than pushing the form.
  multiline: { minHeight: 88, maxHeight: 132, textAlignVertical: 'top' },
});
