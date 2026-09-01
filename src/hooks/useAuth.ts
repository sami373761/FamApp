/**
 * Access to the auth state provided by `AuthProvider`.
 *
 * Note: the rest of `src/hooks` is kebab-case (`use-theme.ts`); this file keeps
 * the camelCase name the service tier spec asked for.
 */

import { useContext } from 'react';

import { AuthContext, type AuthContextValue } from '@/context/AuthContext';

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used inside <AuthProvider>. Check the root layout.');
  }

  return context;
}
