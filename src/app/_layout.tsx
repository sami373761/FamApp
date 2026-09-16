import { ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider } from '@/context/AuthContext';
import { FamilyProvider } from '@/context/FamilyContext';
import { LocationProvider } from '@/context/LocationContext';
import { PreferencesProvider } from '@/context/PreferencesContext';
import { useNavigationTheme, useTheme } from '@/hooks/use-theme';
import { RootNavigator } from '@/navigation/RootNavigator';

/**
 * App shell: settings, gesture root, safe areas, theme, auth and family state.
 *
 * `PreferencesProvider` is outermost because `useTheme` reads the stored
 * appearance from it, and the shell itself is themed — so the layout is split
 * in two, with everything that calls a theme hook living below the provider.
 *
 * Which screens are reachable is `RootNavigator`'s job — it needs `useAuth`,
 * so it renders inside `AuthProvider` rather than here. `FamilyProvider` sits
 * between the two because it is keyed on `profile.family_id`: it holds nothing
 * until there is a family, and every tab reads the same rows from it.
 *
 * `LocationProvider` is innermost because it reads all three: the family id it
 * writes against, the sharing preference that gates it, and the roster its own
 * new position lands in. It owns the *one* timer that takes a fix, which is why
 * it is a provider and not a hook the Map screen calls — mounted twice, it
 * would track twice.
 */
export default function RootLayout() {
  return (
    <PreferencesProvider>
      <AppShell />
    </PreferencesProvider>
  );
}

function AppShell() {
  const { isDark } = useTheme();
  const navigationTheme = useNavigationTheme();

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <ThemeProvider value={navigationTheme}>
          <StatusBar style={isDark ? 'light' : 'dark'} />

          <AuthProvider>
            <FamilyProvider>
              <LocationProvider>
                <RootNavigator />
              </LocationProvider>
            </FamilyProvider>
          </AuthProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = { root: { flex: 1 } } as const;
