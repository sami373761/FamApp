/**
 * The language picker, opened from the Profile tab's "Language" row.
 *
 * A `Sheet` rather than a `Segmented` control, which is what `appearance` next
 * to it uses: three options fit in a segmented row and eleven do not, and the
 * choice is worth a surface of its own because each option has to be shown in
 * its own script. A language a user cannot read is not a choice they can make,
 * so every row leads with the language's own name for itself and carries its
 * English name underneath — the one label someone lost in an unfamiliar script
 * has a chance with.
 *
 * "Match my device" comes first and says which language that currently is, so
 * the default is a visible answer rather than an absence of one. Below it the
 * device's own language is lifted to the top of the ten: whoever is looking for
 * it is overwhelmingly likely to want that one.
 *
 * Each row writes the preference and closes. There is no Save: the choice takes
 * effect the moment it is stored — every screen reads `useTranslation`, which is
 * derived from it — so a confirm step would only sit between the tap and a
 * change the user can already see.
 */

import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { PressableScale } from '@/components/ui/pressable-scale';
import { Sheet } from '@/components/ui/sheet';
import { Text } from '@/components/ui/text';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/hooks/use-translation';
import {
  describeLanguage,
  detectDeviceLanguage,
  LANGUAGES,
  type LanguagePreference,
} from '@/i18n';
import { Radius, Spacing } from '@/theme';

type LanguageSheetProps = {
  visible: boolean;
  /** The stored preference, which may be `system`. */
  value: LanguagePreference;
  onSelect: (value: LanguagePreference) => void;
  onClose: () => void;
};

export function LanguageSheet({ visible, value, onSelect, onClose }: LanguageSheetProps) {
  const { t } = useTranslation();

  // Read once per open rather than per row: it is a `Intl` construction, and it
  // cannot change while the sheet is on screen.
  const deviceLanguage = useMemo(() => detectDeviceLanguage(), []);

  const ordered = useMemo(
    () => [
      ...LANGUAGES.filter((language) => language.code === deviceLanguage),
      ...LANGUAGES.filter((language) => language.code !== deviceLanguage),
    ],
    [deviceLanguage],
  );

  const choose = (next: LanguagePreference) => {
    onSelect(next);
    onClose();
  };

  return (
    <Sheet
      visible={visible}
      title={t('language.title')}
      description={t('language.description')}
      onClose={onClose}>
      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        <LanguageRow
          title={t('language.system')}
          subtitle={t('language.systemDetail', {
            language: describeLanguage(deviceLanguage).nativeName,
          })}
          selected={value === 'system'}
          onPress={() => choose('system')}
        />

        {ordered.map((language) => (
          <LanguageRow
            key={language.code}
            title={language.nativeName}
            subtitle={language.englishName}
            /*
              The native name is the label, so the accessibility label spells
              out the action instead — a screen reader announcing two names in
              two languages says nothing about what the row does.
            */
            accessibilityLabel={t('language.a11y', { language: language.englishName })}
            selected={value === language.code}
            onPress={() => choose(language.code)}
          />
        ))}
      </ScrollView>
    </Sheet>
  );
}

type LanguageRowProps = {
  title: string;
  subtitle: string;
  accessibilityLabel?: string;
  selected: boolean;
  onPress: () => void;
};

function LanguageRow({
  title,
  subtitle,
  accessibilityLabel,
  selected,
  onPress,
}: LanguageRowProps) {
  const { colors } = useTheme();

  return (
    <PressableScale
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={accessibilityLabel ?? title}
      onPress={onPress}
      // Picking within a set, so the selection tick rather than an impact.
      feedback="select"
      style={[
        styles.row,
        {
          backgroundColor: selected ? colors.primarySoft : colors.surface,
          borderColor: selected ? colors.primary : colors.border,
        },
      ]}>
      <View style={styles.text}>
        <Text variant="bodyStrong" color={selected ? 'primary' : 'text'} numberOfLines={1}>
          {title}
        </Text>
        <Text variant="caption" color="textTertiary" numberOfLines={1}>
          {subtitle}
        </Text>
      </View>

      {selected ? <Ionicons name="checkmark" size={20} color={colors.primary} /> : null}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  // Capped so the eleven rows cannot push the sheet past a short screen.
  scroll: { maxHeight: 420 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    marginBottom: Spacing.sm,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  text: { flex: 1, gap: 2 },
});
