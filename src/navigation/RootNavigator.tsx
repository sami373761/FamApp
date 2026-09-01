/**
 * Auth-driven routing.
 *
 * Four mutually exclusive states decide which screens exist at all:
 *
 *   no session                  -> welcome, sign-in, sign-up
 *   session, no family, no skip -> create-family, join-family
 *   in the app but no avatar    -> avatar-builder
 *   in the app with an avatar   -> the tab navigator (+ the Profile screens
 *                                  and the `premium` paywall)
 *
 * "In the app" is a family **or** the `familySetupSkippedFor` preference: family
 * setup can be postponed, and the app runs solo until then (every list is
 * already empty-state driven, so nothing has to be faked for a family of none).
 * Setup is not mounted alongside the tabs — going back to it means *clearing*
 * that preference, which flips this guard exactly the way joining a family
 * does. That keeps one rule for movement rather than two.
 *
 * This is expo-router, so there is no `createStackNavigator` to assemble —
 * routes come from the files under `src/app`, and `Stack.Protected` decides
 * which of them are mounted. When a guard flips to false the router unmounts
 * that branch and lands on the first screen of whichever branch is now open,
 * so signing out or joining a family moves the user without an explicit
 * `router.replace`. The older redirect-inside-an-effect pattern is deprecated.
 */

import { Stack } from 'expo-router';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { parseAvatarConfig } from '@/data/avatar';
import { useAuth } from '@/hooks/useAuth';
import { usePreferences } from '@/hooks/usePreferences';
import { useTheme } from '@/hooks/use-theme';

export function RootNavigator() {
  const { colors } = useTheme();
  const { session, profile, isLoading } = useAuth();
  const { preferences, isHydrated } = usePreferences();

  // Every guard would read false while the stored session is still being read,
  // which would mount the auth stack and immediately tear it down again. The
  // stored preferences are waited on for the same reason: `familySetupSkippedFor`
  // defaults to null, so acting before it is read would flash family setup at
  // someone who already skipped it.
  if (isLoading || !isHydrated) {
    return (
      <View style={[styles.splash, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const isSignedIn = !!session;
  const hasFamily = !!profile?.family_id;
  // A real family outranks the skip: joining one from inside the app keeps the
  // user in it whether or not the preference was ever set. The skip is matched
  // against *this* session's user so a shared device cannot carry one account's
  // choice onto the next person to sign in.
  const inApp = hasFamily || (!!session && preferences.familySetupSkippedFor === session.user.id);
  // `avatar_config` defaults to `{}`, so "has a row" is not "has an avatar" —
  // only a complete configuration counts. Skipping the builder still writes
  // one, which is what stops this guard reopening on the next launch.
  const hasAvatar = !!parseAvatarConfig(profile?.avatar_config);

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
      }}>
      <Stack.Protected guard={!isSignedIn}>
        <Stack.Screen name="index" />
        <Stack.Screen name="sign-in" />
        <Stack.Screen name="sign-up" />
      </Stack.Protected>

      <Stack.Protected guard={isSignedIn && !inApp}>
        <Stack.Screen name="create-family" />
        <Stack.Screen name="join-family" />
      </Stack.Protected>

      <Stack.Protected guard={isSignedIn && inApp && !hasAvatar}>
        <Stack.Screen name="avatar-builder" />
      </Stack.Protected>

      <Stack.Protected guard={isSignedIn && inApp && hasAvatar}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="edit-avatar" />
        <Stack.Screen name="edit-profile" />
        {/*
          The in-app way to get a family, for someone who skipped setup. Not the
          same screen as `create-family`: that one is onboarding and belongs to
          a branch this user is past, and its "Skip"/"Sign out" exits are
          nonsense once you are already inside the app. This one is pushed from
          Profile and pops back to it.
        */}
        <Stack.Screen name="add-family" />
        {/*
          The paywall. A modal rather than a push because it is an interruption
          the user did not navigate *into* — it is offered from Home and from
          Profile, and both expect to still be there underneath when it closes.
        */}
        <Stack.Screen name="premium" options={{ presentation: 'modal' }} />
        {/*
          Mounted for every member, not just admins: the roster is readable by
          anyone in the family, and who may remove someone is settled by
          `remove_member` in the database rather than by which screens exist.
        */}
        <Stack.Screen name="manage-members" />
      </Stack.Protected>
    </Stack>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
