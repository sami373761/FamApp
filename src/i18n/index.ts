/**
 * The translation layer: one function, `translate`, and the `Translator` the
 * app carries around.
 *
 * **There is no ambient "current language".** A translator is created from the
 * stored preference by `useTranslation()` and passed explicitly to anything
 * outside React that produces copy — `data/format.ts`, `data/activity.ts`.
 * A module-level mutable language would have been fewer lines and is what most
 * i18n packages do, but it would make `relativeTime()` depend on hidden state
 * and quietly break the rule that `data/` derives rather than reads. Passing it
 * keeps those functions pure and testable at any language.
 *
 * **Services do not translate at all.** They name a key (see `ServiceError`'s
 * `messageKey` in `services/result.ts`) and the screen resolves it, which is the
 * same reason `error.code` is already a closed union: the failure is data, the
 * sentence is presentation. The database's own messages are the exception and
 * arrive as English text with no key, because they are written server-side.
 *
 * **RTL is text direction, not layout.** Arabic renders with
 * `writingDirection: 'rtl'` on the `Text` primitive, which is what gets bidi
 * punctuation and mixed Latin/Arabic runs right. The full mirrored layout would
 * mean `I18nManager.forceRTL`, and that only takes effect after an app restart —
 * a language picker that demands a relaunch to finish is worse than one that
 * leaves the columns where they were.
 */

import { describeLanguage, FALLBACK_LANGUAGE, resolveLanguage } from '@/i18n/languages';
import { ar } from '@/i18n/translations/ar';
import { de } from '@/i18n/translations/de';
import { en, type TranslationKey, type Translations } from '@/i18n/translations/en';
import { es } from '@/i18n/translations/es';
import { fr } from '@/i18n/translations/fr';
import { it } from '@/i18n/translations/it';
import { ja } from '@/i18n/translations/ja';
import { pt } from '@/i18n/translations/pt';
import { ru } from '@/i18n/translations/ru';
import { tr } from '@/i18n/translations/tr';
import type {
  Language,
  LanguagePreference,
  PluralCategory,
  PluralForms,
  TranslationVars,
} from '@/i18n/types';

export type { Language, LanguagePreference, TranslationVars } from '@/i18n/types';
export type { TranslationKey } from '@/i18n/translations/en';
export {
  describeLanguage,
  detectDeviceLanguage,
  FALLBACK_LANGUAGE,
  LANGUAGES,
  matchLanguage,
  resolveLanguage,
} from '@/i18n/languages';

/**
 * `en` is typed as `Translations` here rather than at its definition, which is
 * what would be circular — `Translations` is derived from it. Every other
 * catalog declares the type at its own definition and fails there instead.
 */
const CATALOGS: Record<Language, Translations> = { en, tr, es, fr, de, it, pt, ru, ar, ja };

/** One `Intl.PluralRules` per locale — constructing one is not free. */
const PLURAL_RULES = new Map<string, Intl.PluralRules>();

function pluralRulesFor(locale: string): Intl.PluralRules | null {
  const cached = PLURAL_RULES.get(locale);

  if (cached) return cached;

  try {
    const rules = new Intl.PluralRules(locale);
    PLURAL_RULES.set(locale, rules);

    return rules;
  } catch {
    // A runtime without plural data still renders — every catalog carries
    // `other`, which is the correct answer for most counts in most languages.
    return null;
  }
}

function isPluralForms(value: string | PluralForms): value is PluralForms {
  return typeof value !== 'string';
}

/**
 * Picks the form for `count`. Falls through to `other`, which every catalog is
 * required to supply, so a language that needs `few` and a catalog that forgot
 * it degrade to a real sentence rather than to the key.
 */
function pluralise(forms: PluralForms, count: number, locale: string): string {
  const category = (pluralRulesFor(locale)?.select(count) ?? 'other') as PluralCategory;

  return forms[category] ?? forms.other;
}

/** Substitutes `{{name}}`. A placeholder with no value is left as it is, which
 *  reads as a bug in the catalog rather than as a blank in the sentence. */
function interpolate(template: string, vars?: TranslationVars): string {
  if (!vars) return template;

  return template.replace(/\{\{(\w+)\}\}/g, (whole, name: string) => {
    const value = vars[name];

    return value === undefined ? whole : String(value);
  });
}

/**
 * The whole lookup. Falls back to English per key rather than per catalog, so a
 * language missing one string still shows the other three hundred in its own
 * words.
 */
export function translate(
  language: Language,
  key: TranslationKey,
  vars?: TranslationVars,
): string {
  const catalog = CATALOGS[language] ?? CATALOGS[FALLBACK_LANGUAGE];
  const value = catalog[key] ?? CATALOGS[FALLBACK_LANGUAGE][key];

  if (value === undefined) return key;

  const template = isPluralForms(value)
    ? pluralise(value, typeof vars?.count === 'number' ? vars.count : 0, describeLanguage(language).locale)
    : value;

  return interpolate(template, vars);
}

export type Translate = (key: TranslationKey, vars?: TranslationVars) => string;

/**
 * Everything a caller needs to render in one language: the copy, and the locale
 * tag for `Intl` (dates, times, number formatting), which must never be read
 * from the device once someone has chosen a language by hand.
 */
export type Translator = {
  /** Resolved — never `system`. */
  language: Language;
  /** BCP-47 tag for `toLocaleDateString` and friends. */
  locale: string;
  isRTL: boolean;
  t: Translate;
};

export function createTranslator(preference: LanguagePreference): Translator {
  const language = resolveLanguage(preference);
  const descriptor = describeLanguage(language);

  return {
    language,
    locale: descriptor.locale,
    isRTL: descriptor.isRTL,
    t: (key, vars) => translate(language, key, vars),
  };
}

/**
 * A message a service refuses to write out: the key, and whatever it needs
 * filling in. Resolved wherever the language is known.
 */
export type MessageRef = { key: TranslationKey; vars?: TranslationVars };
