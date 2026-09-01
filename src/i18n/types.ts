/**
 * The vocabulary the translation layer is built from.
 *
 * Kept apart from the catalogs so `translations/en.ts` — which is the source of
 * truth for *which* keys exist — can import `PluralForms` without the catalogs
 * and the types importing each other in a cycle at runtime.
 */

/**
 * The ten languages the app ships. A closed union rather than a string: every
 * catalog is checked against it, so adding a language is one entry here and one
 * file that will not compile until it is complete.
 */
export type Language = 'en' | 'tr' | 'es' | 'fr' | 'de' | 'it' | 'pt' | 'ru' | 'ar' | 'ja';

/**
 * What is stored. `system` is not a language — it defers to the device, and is
 * resolved to one of the ten at read time, exactly like `appearance`'s `system`
 * defers to the OS colour scheme.
 */
export type LanguagePreference = 'system' | Language;

/**
 * CLDR's plural categories. Which ones a language actually uses is the
 * language's business — `Intl.PluralRules` decides, and a catalog only supplies
 * the forms it needs. English uses two, Turkish and Japanese one, Russian four.
 */
export type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';

/**
 * A countable string. `other` is required because it is the fallback for every
 * category a catalog leaves out, so a plural entry can never resolve to nothing.
 */
export type PluralForms = Partial<Record<PluralCategory, string>> & { other: string };

/**
 * Values interpolated into `{{name}}` placeholders. `count` is special: its
 * presence is what selects a plural form.
 */
export type TranslationVars = Record<string, string | number>;

export type LanguageDescriptor = {
  code: Language;
  /** The language's own name for itself — what the picker shows. */
  nativeName: string;
  /** Its name in English, as a second line for someone lost in a script they cannot read. */
  englishName: string;
  /**
   * BCP-47 tag handed to `Intl` for dates, times and plural rules. Separate from
   * `code` so a language whose canonical tag is regional can carry it.
   */
  locale: string;
  /** True for right-to-left scripts. Arabic is the only one here. */
  isRTL: boolean;
};
