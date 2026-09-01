/**
 * Access to the position tracker provided by `LocationProvider`.
 *
 * Named to match `useAuth` and `useFamily`, the other app-wide state hooks.
 * This is about *your own* position — taking a fix and storing it. Everyone
 * else's positions arrive with the roster, through `useFamily`.
 */

import { useContext } from 'react';

import { LocationContext, type LocationContextValue } from '@/context/LocationContext';

export function useLocation(): LocationContextValue {
  const context = useContext(LocationContext);

  if (!context) {
    throw new Error('useLocation must be used inside <LocationProvider>. Check the root layout.');
  }

  return context;
}
