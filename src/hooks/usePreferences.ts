/**
 * Access to the device settings provided by `PreferencesProvider`.
 *
 * Named to match `useAuth` and `useFamily`, the other app-wide state hooks.
 * `useTheme` reads this too, so the provider has to sit above everything —
 * see `src/app/_layout.tsx`.
 */

import { useContext } from 'react';

import { PreferencesContext, type PreferencesContextValue } from '@/context/PreferencesContext';

export function usePreferences(): PreferencesContextValue {
  const context = useContext(PreferencesContext);

  if (!context) {
    throw new Error('usePreferences must be used inside <PreferencesProvider>. Check the root layout.');
  }

  return context;
}
