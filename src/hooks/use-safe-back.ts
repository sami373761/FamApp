/**
 * Going back without assuming there is a back.
 *
 * `router.back()` is only legal when the stack has somewhere to pop to. It very
 * often does not here:
 *
 *   - `RootNavigator` swaps whole branches with `Stack.Protected`, so the first
 *     screen of a branch (`create-family`, `sign-in` after a cold start) is the
 *     bottom of the stack;
 *   - the auth and setup screens move between peers with `router.replace`,
 *     which *consumes* the entry rather than adding one;
 *   - on web every route is reachable by URL, so any screen can be the first
 *     one the user ever sees.
 *
 * In all three cases `back()` is dispatched to a navigator that cannot handle
 * it. `useSafeBack` asks first, falls back to a route that definitely exists,
 * and does nothing at all rather than throwing when there is neither.
 *
 * It also refuses to navigate after the caller has unmounted. Screens here call
 * `router.back()` *after* awaiting a write, and in that window the user may have
 * gone back themselves or a guard may have swapped the branch out — popping
 * again would take a screen nobody asked to leave.
 */

import type { Href } from 'expo-router';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';

/**
 * `() => boolean`, false once the caller has unmounted.
 *
 * A ref rather than state on purpose: it is read inside async continuations,
 * where a stale closure over a state value would answer for the wrong render.
 */
export function useIsMounted(): () => boolean {
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
    };
  }, []);

  return useCallback(() => mounted.current, []);
}

/**
 * @param fallback where to go when the stack is empty — the screen that would
 *   have been underneath had the user arrived the usual way.
 */
export function useSafeBack(fallback?: Href): () => void {
  const router = useRouter();
  const isMounted = useIsMounted();

  return useCallback(() => {
    if (!isMounted()) return;

    if (router.canGoBack()) {
      router.back();
      return;
    }

    // `replace`, not `push`: there is nothing below this screen, so pushing
    // would build a stack whose back button has the same problem again.
    if (fallback) router.replace(fallback);
  }, [fallback, isMounted, router]);
}
