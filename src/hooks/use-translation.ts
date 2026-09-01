/**
 * The app's one way to reach the copy.
 *
 * Named and shaped after `useTheme`, and for the same reason: both resolve a
 * stored preference into the concrete thing a component renders with, and
 * neither lets a caller reach past it to the raw value. `useTheme` gives you
 * `colors`; this gives you `t`.
 *
 * It reads `usePreferences`, so — exactly like the theme hooks — anything that
 * calls it lives under `PreferencesProvider` (see `src/app/_layout.tsx`, split
 * into `RootLayout` and `AppShell` for this).
 *
 * The returned `Translator` is memoised on the resolved language, so passing it
 * down to a `useMemo` that folds copy (Home's status pill, the activity feed)
 * gives that memo a dependency that changes exactly when the language does.
 */

import { useMemo } from 'react';

import { createTranslator, type Translator } from '@/i18n';
import { usePreferences } from '@/hooks/usePreferences';

export function useTranslation(): Translator {
  const { preferences } = usePreferences();

  return useMemo(() => createTranslator(preferences.language), [preferences.language]);
}
