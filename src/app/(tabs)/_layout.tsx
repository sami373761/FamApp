import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router/js-tabs';
import { StyleSheet } from 'react-native';

import { useTabBarMetrics } from '@/hooks/use-tab-bar';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/hooks/use-translation';
import { Radius, Shadow, Spacing } from '@/theme';

/**
 * The glyph size, ignoring the `size` the navigator offers each `tabBarIcon`.
 * That number comes from a fixed table in react-navigation (25pt for this
 * variant), sized for a bar with a label under every icon; without the labels
 * it reads as small in a 64pt island.
 */
const TAB_ICON_SIZE = 28;

/**
 * Bottom tab navigator.
 *
 * Uses expo-router's JS `Tabs` (rather than NativeTabs) so the five tabs render
 * and theme identically on iOS and Android. In expo-router 7 that import moved
 * to `expo-router/js-tabs`; the `Tabs` still exported from `expo-router` itself
 * is deprecated.
 *
 * The bar is a floating island: detached from the bottom edge, inset from both
 * sides and fully rounded, so the canvas runs behind it. That is a layout
 * consequence as much as a look — an absolutely positioned tab bar takes no
 * space out of the scene, so every tab screen pads its own content past it with
 * `useTabBarMetrics().clearance`. Change the metrics in `theme/layout.ts`, not
 * here.
 */
export default function TabsLayout() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { height, offset } = useTabBarMetrics();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        // The tab navigator paints its own view behind each scene; without this
        // it falls back to the navigation theme rather than our canvas.
        sceneStyle: { backgroundColor: colors.background },
        // Android resizes the window for the keyboard, which would slide the
        // island up on top of the chat composer; hiding it is what every other
        // floating bar does there.
        tabBarHideOnKeyboard: true,
        // Icon-only: the five destinations are conventional enough to read as
        // glyphs, and the island is small enough that a label under each one
        // crowds it. `title` is still set per screen, so the tab keeps its
        // accessibility label — this hides the text, it does not remove it.
        tabBarShowLabel: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textTertiary,
        tabBarStyle: {
          position: 'absolute',
          left: Spacing.lg,
          right: Spacing.lg,
          bottom: offset,
          height,
          // No vertical padding: with nothing under the icon, each item is free
          // to take the full height of the bar and centre its glyph in it.
          paddingTop: 0,
          paddingBottom: 0,
          borderRadius: Radius.pill,
          // The stock top border belongs to a bar welded to the edge; this one
          // is outlined all the way round instead.
          borderTopWidth: 0,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: colors.border,
          // Elevated rather than `surface`: in dark mode the island has to step
          // up from the canvas it now floats over.
          backgroundColor: colors.surfaceElevated,
          ...Shadow.floating,
        },
        tabBarItemStyle: { borderRadius: Radius.pill },
        /*
          Centring has to happen here, not on the item. Each tab's pressable is
          laid out by the navigator as a column with `justifyContent:
          'flex-start'`, which pinned the glyph to the top of a bar that is now
          taller than a label-less icon needs — and `tabBarItemStyle` only
          reaches the wrapper *around* that pressable. Auto margins on the icon
          itself are what actually centre it in the leftover space. The box is
          also widened to `TAB_ICON_SIZE`, since the navigator sizes this
          wrapper for its own 25pt glyph.
        */
        tabBarIconStyle: {
          width: TAB_ICON_SIZE,
          height: TAB_ICON_SIZE,
          marginTop: 'auto',
          marginBottom: 'auto',
        },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: t('tabs.home'),
          tabBarIcon: ({ color }) => <Ionicons name="home" size={TAB_ICON_SIZE} color={color} />,
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: t('tabs.chat'),
          tabBarIcon: ({ color }) => <Ionicons name="chatbubbles" size={TAB_ICON_SIZE} color={color} />,
        }}
      />
      <Tabs.Screen
        name="map"
        options={{
          title: t('tabs.map'),
          tabBarIcon: ({ color }) => <Ionicons name="map" size={TAB_ICON_SIZE} color={color} />,
        }}
      />
      <Tabs.Screen
        name="tasks"
        options={{
          title: t('tabs.tasks'),
          tabBarIcon: ({ color }) => (
            <Ionicons name="checkbox" size={TAB_ICON_SIZE} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t('tabs.profile'),
          tabBarIcon: ({ color }) => <Ionicons name="person" size={TAB_ICON_SIZE} color={color} />,
        }}
      />
    </Tabs>
  );
}
