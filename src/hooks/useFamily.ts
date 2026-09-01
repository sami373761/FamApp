/**
 * Access to the family data provided by `FamilyProvider`.
 *
 * Named to match `useAuth`, which is the other app-wide state hook.
 */

import { useContext } from 'react';

import { FamilyContext, type FamilyContextValue } from '@/context/FamilyContext';

export function useFamily(): FamilyContextValue {
  const context = useContext(FamilyContext);

  if (!context) {
    throw new Error('useFamily must be used inside <FamilyProvider>. Check the root layout.');
  }

  return context;
}
