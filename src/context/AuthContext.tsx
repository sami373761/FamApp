/**
 * Global auth state: the session, its user, and that user's `profiles` row.
 *
 * The profile is part of auth state rather than a screen concern because
 * navigation depends on it — `family_id` decides whether someone lands in
 * onboarding or the app (see `RootNavigator`).
 */

import type { Session, User } from '@supabase/supabase-js';
import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

import * as authService from '@/services/authService';
import type { AuthResult, SignUpOutcome } from '@/services/authService';
import { PROFILE_COLUMNS, type ProfileRow } from '@/services/familyService';
import { supabase } from '@/services/supabase';

export type AuthContextValue = {
  session: Session | null;
  user: User | null;
  /** Null once loaded if the row genuinely does not exist. */
  profile: ProfileRow | null;
  /**
   * True until both the stored session and — when signed in — the profile have
   * resolved. Guarding on this is what stops a signed-in user with a family
   * flashing through the onboarding stack on cold start.
   */
  isLoading: boolean;
  signInWithEmail: (email: string, password: string) => Promise<AuthResult<Session>>;
  signUpWithEmail: (email: string, password: string) => Promise<AuthResult<SignUpOutcome>>;
  /**
   * Redeems the 6-digit sign-up code. The returned session lands here through
   * `onAuthStateChange` like any other, so the caller does not navigate.
   */
  verifyEmailOtp: (email: string, token: string) => Promise<AuthResult<Session>>;
  resendSignUpOtp: (email: string) => Promise<AuthResult<null>>;
  signInWithGoogle: () => Promise<AuthResult<Session | null>>;
  signOut: () => Promise<AuthResult<null>>;
  /** Re-reads the profile — call after creating or joining a family. */
  refreshProfile: () => Promise<void>;
};

export const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * A fetched profile is stamped with the user it belongs to, so the value can be
 * *derived* rather than synchronised. Without the stamp we would need to clear
 * the profile from an effect on every user change, which both trips the React
 * Compiler's set-state-in-effect rule and leaves a window where one user's
 * profile is readable under the next user's session.
 */
type FetchedProfile = { userId: string; row: ProfileRow | null };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [fetched, setFetched] = useState<FetchedProfile | null>(null);
  const [isSessionResolved, setIsSessionResolved] = useState(false);

  const userId = session?.user.id ?? null;

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;

      setSession(data.session);
      setIsSessionResolved(true);
    });

    // Fires for SIGNED_IN, SIGNED_OUT, TOKEN_REFRESHED and USER_UPDATED. The
    // callback stays synchronous on purpose: awaiting a supabase call inside it
    // can deadlock the auth client's internal lock. Fetching the profile is
    // left to the effect below, keyed on the user id.
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setIsSessionResolved(true);
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const fetchProfile = useCallback(async (id: string): Promise<ProfileRow | null> => {
    const { data, error } = await supabase
      .from('profiles')
      .select(PROFILE_COLUMNS)
      .eq('id', id)
      .maybeSingle();

    // A read failure is not a signed-out state; keep the session and report no
    // profile so the UI can retry rather than bouncing the user to sign-in.
    if (error) return null;

    return data;
  }, []);

  useEffect(() => {
    if (!userId) return;

    let active = true;

    void fetchProfile(userId).then((row) => {
      if (active) setFetched({ userId, row });
    });

    return () => {
      active = false;
    };
  }, [userId, fetchProfile]);

  const refreshProfile = useCallback(async () => {
    if (!userId) return;

    setFetched({ userId, row: await fetchProfile(userId) });
  }, [userId, fetchProfile]);

  // Anything stamped with a different user is a leftover from the previous
  // session and must not be read.
  const isProfileForCurrentUser = !!userId && fetched?.userId === userId;

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      profile: isProfileForCurrentUser ? (fetched?.row ?? null) : null,
      isLoading: !isSessionResolved || (!!userId && !isProfileForCurrentUser),
      signInWithEmail: authService.signInWithEmail,
      signUpWithEmail: authService.signUpWithEmail,
      verifyEmailOtp: authService.verifyEmailOtp,
      resendSignUpOtp: authService.resendSignUpOtp,
      signInWithGoogle: authService.signInWithGoogle,
      signOut: authService.signOut,
      refreshProfile,
    }),
    [session, fetched, isProfileForCurrentUser, isSessionResolved, userId, refreshProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
