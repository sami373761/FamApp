/**
 * The ten languages, and how the device's own choice is read.
 *
 * **No new dependency.** `expo-localization` would be the obvious way to ask
 * for the device locale, but Hermes ships full ICU on iOS and Android and
 * `Intl.DateTimeFormat().resolvedOptions().locale` answers the same question on
 * every target the app runs on — including web, where `navigator.language` is
 * consulted first because it tracks the *browser's* preference rather than the
 * OS clock's. So the detection below is a few lines instead of a package, which
 * matches the rest of `package.json` being trimmed rather than grown.
 *
 * The `system` preference is resolved through here on every read rather than
 * being written down once: someone who changes their phone's language expects
 * the app to follow without being told again.
 */

import { Platform } from 'react-native';

import type { Language, LanguageDescriptor, LanguagePreference } from '@/i18n/types';

/**
 * Ordered as the picker shows them: the device's own language is lifted to the
 * top at render, so this list is otherwise alphabetical by English name with
 * English first — the app's source language, and its fallback.
 */
export const LANGUAGES: readonly LanguageDescriptor[] = [
  { code: 'en', nativeName: 'English', englishName: 'English', locale: 'en', isRTL: false },
  { code: 'ar', nativeName: 'العربية', englishName: 'Arabic', locale: 'ar', isRTL: true },
  { code: 'fr', nativeName: 'Français', englishName: 'French', locale: 'fr', isRTL: false },
  { code: 'de', nativeName: 'Deutsch', englishName: 'German', locale: 'de', isRTL: false },
  { code: 'it', nativeName: 'Italiano', englishName: 'Italian', locale: 'it', isRTL: false },
  { code: 'ja', nativeName: '日本語', englishName: 'Japanese', locale: 'ja', isRTL: false },
  { code: 'pt', nativeName: 'Português', englishName: 'Portuguese', locale: 'pt', isRTL: false },
  { code: 'ru', nativeName: 'Русский', englishName: 'Russian', locale: 'ru', isRTL: false },
  { code: 'es', nativeName: 'Español', englishName: 'Spanish', locale: 'es', isRTL: false },
  { code: 'tr', nativeName: 'Türkçe', englishName: 'Turkish', locale: 'tr', isRTL: false },
];

/** What everything falls back to: the catalog the other nine are derived from. */
export const FALLBACK_LANGUAGE: Language = 'en';

const BY_CODE = new Map<string, LanguageDescriptor>(
  LANGUAGES.map((language) => [language.code, language]),
);

export function describeLanguage(language: Language): LanguageDescriptor {
  // The map is built from the same union, so this cannot miss — the fallback is
  // for a stored value that predates a language being removed.
  return BY_CODE.get(language) ?? BY_CODE.get(FALLBACK_LANGUAGE)!;
}

/**
 * Reads the device's preferred language tag, or null when the platform will not
 * say. Never throws: `Intl` is present on every target the app supports, but a
 * stripped runtime returning nothing must read as "no preference" rather than
 * taking the screen down.
 */
function deviceLanguageTag(): string | null {
  try {
    if (Platform.OS === 'web') {
      const navigatorLanguage =
        typeof navigator !== 'undefined'
          ? (navigator.languages?.[0] ?? navigator.language)
          : undefined;

      if (navigatorLanguage) return navigatorLanguage;
    }

    return new Intl.DateTimeFormat().resolvedOptions().locale || null;
  } catch {
    return null;
  }
}

/**
 * Matches a BCP-47 tag against the ten, on the primary subtag only: `pt-BR`,
 * `pt-PT` and `pt` all resolve to Portuguese. Regional variants are deliberately
 * not separate catalogs — ten languages is the scope, and pretending to
 * distinguish Brazilian from European Portuguese without separate copy would be
 * a claim the translations do not back.
 */
export function matchLanguage(tag: string | null | undefined): Language | null {
  if (!tag) return null;

  const primary = tag.toLowerCase().split(/[-_]/)[0];
  const match = LANGUAGES.find((language) => language.code === primary);

  return match?.code ?? null;
}

/** The device's language when it is one of the ten, English otherwise. */
export function detectDeviceLanguage(): Language {
  return matchLanguage(deviceLanguageTag()) ?? FALLBACK_LANGUAGE;
}

/** Turns the stored preference into the language actually being rendered. */
export function resolveLanguage(preference: LanguagePreference): Language {
  return preference === 'system' ? detectDeviceLanguage() : preference;
}
