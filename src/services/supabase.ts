/**
 * The one Supabase client the app talks to.
 * https://supabase.com/docs/guides/auth/quickstarts/react-native
 */

import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, processLock } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

import type { Database } from '@/data/database.types';

/**
 * `EXPO_PUBLIC_*` values are inlined at build time, so the fallbacks are what
 * ship unless a `.env` overrides them. Both are safe to embed: the publishable
 * key only ever reaches the database as `anon`, which our RLS policies grant
 * nothing — every policy is scoped `to authenticated`.
 */
export const SUPABASE_URL =
  process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://mdgjzuczzjxlbivcbdnp.supabase.co';

export const SUPABASE_ANON_KEY =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? 'sb_publishable_r8_I_8HYzXPWYPNVyAUd9Q_Lv2qHp4-';

const isWeb = Platform.OS === 'web';

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    // Web has localStorage (and none during the server render, where supabase-js
    // falls back to memory on its own); native needs an explicit adapter.
    storage: isWeb ? undefined : AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    // Only meaningful for an OAuth redirect landing back on a URL, which is web-only.
    detectSessionInUrl: isWeb,
    // navigatorLock is the web default and relies on APIs React Native lacks.
    lock: isWeb ? undefined : processLock,
  },
});

/**
 * Refresh tokens only while the app is in the foreground.
 *
 * Without this the timer keeps firing after backgrounding, which either burns
 * work the OS will suspend anyway or wakes up to a stale token. Web has no
 * equivalent lifecycle, and its own tab visibility handling already covers it.
 */
if (!isWeb) {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      void supabase.auth.startAutoRefresh();
    } else {
      void supabase.auth.stopAutoRefresh();
    }
  });
}
