/**
 * A calendar date, typed.
 *
 * **There is no date picker in this app and this is not one.** RN's own
 * `DateTimePicker` is a separate dependency, `@react-native-community/
 * datetimepicker` is another, and both render a native wheel that has no web
 * implementation worth the name — so either would be a package added to a
 * `package.json` that already carries too many unused ones, for two fields. The
 * honest alternative is a text field that says exactly what shape it wants and
 * refuses anything else, which is what this is.
 *
 * It keeps its own **text**, not a date, and reports the parsed value up. That
 * split is the whole design: somebody typing `1990-0` has not entered an
 * invalid date, they have entered part of one, and a field that fought them
 * mid-keystroke would be unusable. So `onChange` receives null until the text
 * is a real date, and `error` is only shown once the field is long enough that
 * the user has plainly finished.
 *
 * The format is ISO `YYYY-MM-DD` in every language, and deliberately so: it is
 * what the `date` column stores, it is unambiguous where `03/04/2026` is not,
 * and the placeholder shows it. Localising the *input* format would mean
 * parsing ten conventions and guessing which one a given user meant — the
 * rendered dates elsewhere in the app are localised through `i18n.locale`,
 * which is where that belongs.
 *
 * **The dashes are inserted, so only digits are typed.** That is not a
 * convenience, it is what lets the field keep `TextField`'s existing
 * `number-pad` rather than widening that closed vocabulary for one screen: an
 * iOS number pad has no dash, so a format the user had to punctuate themselves
 * would need a keyboard the primitive does not offer. Re-deriving the whole
 * string from the digits on every keystroke is also what makes backspace work
 * across a dash without a cursor rule.
 */

import { useState } from 'react';

import { TextField } from '@/components/ui/text-field';
import { parseDateOnly } from '@/data/events';
import { useTranslation } from '@/hooks/use-translation';

/** `YYYY-MM-DD` — the exact length of a complete value. */
const ISO_LENGTH = 10;

/** Four digits of year, two of month, two of day. */
const ISO_DIGITS = 8;

/**
 * Digits in, `YYYY-MM-DD` out, cut wherever the user has got to.
 *
 * Anything that is not a digit is dropped — including the dashes, which are
 * re-inserted here — so pasting `1990/05/04` or `1990.05.04` lands correctly
 * rather than being refused for punctuation nobody cares about.
 */
function formatDigits(input: string): string {
  const digits = input.replace(/\D/g, '').slice(0, ISO_DIGITS);

  if (digits.length <= 4) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`;

  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
}

type DateFieldProps = {
  label: string;
  /** `YYYY-MM-DD`, or empty. The caller holds the committed value. */
  value: string;
  /**
   * Fires with a valid `YYYY-MM-DD`, with `''` when the field is emptied, and
   * with null while the text is incomplete or not a date. A caller that stores
   * null is storing "not answered yet"; one that stores `''` is storing a
   * deliberate clear.
   */
  onChange: (value: string | null) => void;
  editable?: boolean;
  /** Refuses a date after today — what a birth date needs, and an event does not. */
  disallowFuture?: boolean;
};

export function DateField({
  label,
  value,
  onChange,
  editable = true,
  disallowFuture = false,
}: DateFieldProps) {
  const { t } = useTranslation();

  /**
   * The text lives here rather than in the caller, so a half-typed date is not
   * something the form above has to hold and reason about. It is seeded from
   * `value` once — the caller owns the committed answer, this owns the typing.
   */
  const [text, setText] = useState(value);

  const parsed = parseDateOnly(text);
  /*
    `Date.now()` during render is an impurity, and the rule is right that it is
    one — but "is this date in the future" has no answer that is not read off
    the clock, and the alternatives are worse: a value captured at mount goes
    stale in a field somebody is still typing into, and an effect would only
    move the same read one commit later. The cost of being wrong is a validation
    message that is a millisecond out of date.
  */
  // eslint-disable-next-line react-hooks/purity
  const isFuture = !!parsed && disallowFuture && parsed.getTime() > Date.now();
  // Only complain once they have plainly finished: mid-keystroke every value is
  // "invalid", and saying so on the third character is nagging rather than
  // helping.
  const showError = text.length >= ISO_LENGTH && (!parsed || isFuture);

  function handleChange(next: string) {
    // Rebuilt from the digits rather than patched in place: the dashes are
    // ours, so the only thing worth reading out of what the user typed is the
    // numbers. That is also what makes backspacing over a dash behave —
    // "1990-0" loses its 0, becomes "19900" digits, and formats back to
    // "1990-0" minus the character that was actually deleted.
    const cleaned = formatDigits(next);

    setText(cleaned);

    if (!cleaned) {
      // A deliberate clear, which is different from "not finished typing".
      onChange('');
      return;
    }

    const date = parseDateOnly(cleaned);
    const future = !!date && disallowFuture && date.getTime() > Date.now();

    onChange(date && !future ? cleaned : null);
  }

  return (
    <TextField
      label={label}
      value={text}
      onChangeText={handleChange}
      placeholder={t('dateField.placeholder')}
      // A number pad is enough because the dashes are inserted for the user —
      // see the note above on why that decides the keyboard rather than the
      // other way round.
      keyboardType="number-pad"
      autoCapitalize="none"
      maxLength={ISO_LENGTH}
      editable={editable}
      error={showError ? (isFuture ? t('dateField.future') : t('dateField.invalid')) : undefined}
    />
  );
}
