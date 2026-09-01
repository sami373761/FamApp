/**
 * Where everyone is.
 *
 * Full-bleed on purpose: this is the one screen that does not use `Screen`,
 * because the map belongs behind the safe area with the chrome floating over
 * it. Everything on it comes from a row — a pin exists because that member has
 * a `locations` row, and the drawer under it shows the two things that row
 * carries, coordinates and when it was touched. There is no place name (the
 * schema stores none, and geocoding one would be inventing it) and no battery
 * reading (there is no column, and there is no such reading to take).
 *
 * The drawer peeks by default and opens into the roster. Picking a member from
 * it is the screen's only "camera" control: the map re-centres on their
 * coordinates and widens its span so nobody falls out of frame, and their pin
 * takes a halo. Picking the same member again lets go, back to the family-wide
 * framing.
 *
 * The "Locate me" button is the manual half of `LocationProvider`: the tracker
 * skips a write for anything under 100 m, and this is how someone insists.
 *
 * Saved places are the second thing on the canvas, and the only labelled one —
 * `saved_places` is the first table that can supply a place *name*. They are
 * dropped by pressing and holding the map (both targets support it) or by the
 * "Save a place" button, which seeds the pin at your own position because that
 * is the one coordinate the screen can be sure of. Everything after that — the
 * details of a place, editing one, deleting one — happens in a single `Sheet`
 * that swaps its children, for the same iOS reason Chat's "+" menu does.
 */

import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { FamilyMap } from '@/components/map/family-map';
import { MemberDrawer } from '@/components/map/member-drawer';
import { PlaceSheet, type PlaceSheetState } from '@/components/map/place-sheet';
import { Card, PressableScale, Text } from '@/components/ui';
import type { Coordinates } from '@/data/geo';
import { canSaveAnotherPlace } from '@/data/premium';
import type { SavedPlace } from '@/data/types';
import { useAuth } from '@/hooks/useAuth';
import { useFamily } from '@/hooks/useFamily';
import { useLocation } from '@/hooks/useLocation';
import { usePreferences } from '@/hooks/usePreferences';
import { useTabBarMetrics } from '@/hooks/use-tab-bar';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/hooks/use-translation';
import { Radius, Shadow, Spacing } from '@/theme';

type MapStatus = {
  icon: keyof typeof Ionicons.glyphMap;
  message: string;
  tone: 'neutral' | 'danger';
};

export default function MapScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { user, profile } = useAuth();
  const { members, places, isPremium, getMember, savePlace, editPlace, deletePlace, isLoading } =
    useFamily();
  const { preferences } = usePreferences();
  const { canShare, error, isPermissionDenied, isSyncing, syncNow } = useLocation();
  const { clearance } = useTabBarMetrics();

  const [isDrawerExpanded, setIsDrawerExpanded] = useState(false);

  /*
    One state for the whole place flow — details, the form, the delete
    confirmation — because they share one `Sheet`. It also decides what the map
    draws: which place pin is haloed, and where the draft pin sits.
  */
  const [placeSheet, setPlaceSheet] = useState<PlaceSheetState>({ mode: 'none' });

  /*
    Which member the canvas is centred on lives in the route, not in state: Home
    links here with one already picked ("open the map on this person"), and a
    param cannot arrive after mount the way state would have to be synced to it
    in an effect. It also survives leaving the tab and coming back, which is
    what a map camera does.
  */
  const { member: memberParam } = useLocalSearchParams<{ member?: string }>();
  const focusedId = memberParam || null;
  const setFocusedId = (memberId: string | null) => router.setParams({ member: memberId ?? '' });

  // Read from the profile rather than from `family`, which is also null while a
  // real family is still loading.
  const hasFamily = !!profile?.family_id;

  // Only members actually sharing a position can be drawn.
  const located = useMemo(() => members.filter((member) => member.location !== null), [members]);

  /*
    Only somebody with a position can be centred on, so the param is resolved
    against the located members rather than trusted: it can name a member whose
    row has since been cleared, and that must read as "nothing is focused"
    rather than quietly centring on somebody else.
  */
  const focused = located.find((member) => member.id === focusedId) ?? null;

  // Falling back to your own pin rather than to whoever happens to be first:
  // opening the map to "here is me" reads better than to a random relative.
  const selected =
    focused ?? located.find((member) => member.id === user?.id) ?? located[0] ?? null;

  /*
    The camera frames the whole family — see `regionForLocations` in
    `src/data/geo.ts` — until somebody is picked, which recentres it on them.
    The default framing is deliberately *not* the selected member: showing the
    family whole is what the screen is for, and centring on your own pin every
    time it opens would hide that.
  */
  const focus = focused?.location ?? null;

  /** Own position first: "save a place" almost always means "save this spot". */
  const ownLocation = members.find((member) => member.id === user?.id)?.location ?? null;

  /*
    Where the button would drop a pin. Falling back to whoever the drawer is
    describing keeps it usable for someone who is not sharing themselves, and
    null — nothing on the map at all — is what disables it: a place has to be
    somewhere, and the screen will not invent a coordinate to put one at.
  */
  const seedCoordinates: Coordinates | null = ownLocation ?? selected?.location ?? null;

  /**
   * Opens the composer — unless this would be a *new* place and the family is
   * already at its tier's ceiling, in which case the sheet explains that
   * instead.
   *
   * The check is here rather than on the two controls that call it because the
   * ceiling is worth *saying*. A dimmed "Save a place" button and a long press
   * that quietly did nothing both leave somebody wondering what broke; a panel
   * that names the count and offers the upgrade answers the question they
   * actually have. `check_saved_place_limit()` is still what refuses the write,
   * so a race between two members saving at once ends in the same explanation
   * arriving from the server as `LIMIT_REACHED`.
   *
   * Editing is never gated: an existing place occupies room it already has.
   */
  const openPlaceForm = (coordinates: Coordinates, place: SavedPlace | null = null) => {
    if (!place && !canSaveAnotherPlace(isPremium, places)) {
      setPlaceSheet({ mode: 'locked' });
      return;
    }

    setPlaceSheet({ mode: 'form', placeId: place?.id ?? null, coordinates });
  };

  const closePlaceSheet = () => setPlaceSheet({ mode: 'none' });

  /*
    The draft pin is on the canvas only while the form is open, and only for a
    *new* place: editing one already has a pin drawn from its row, and a second
    hollow one on top of it would read as two places.
  */
  const draft =
    placeSheet.mode === 'form' && !placeSheet.placeId ? placeSheet.coordinates : null;

  /** Which pin wears a halo. Only the three modes that name a place have one. */
  const highlightedPlaceId =
    placeSheet.mode === 'none' || placeSheet.mode === 'locked' ? null : placeSheet.placeId;

  /**
   * Why the button is dim, or why the last fix went nowhere. Nothing is shown
   * when sharing is working — a status line that is always there is chrome.
   */
  const status: MapStatus | null = !hasFamily
    ? {
        icon: 'people-outline',
        message: t('map.noFamily'),
        tone: 'neutral',
      }
    : !preferences.locationSharing
      ? {
          icon: 'eye-off-outline',
          message: t('map.sharingOff'),
          tone: 'neutral',
        }
      : error
        ? {
            icon: isPermissionDenied ? 'lock-closed-outline' : 'alert-circle-outline',
            message: error,
            tone: 'danger',
          }
        : null;

  return (
    <View style={styles.flex}>
      {/* Full-bleed map sits behind the safe area, like a real map screen. */}
      <FamilyMap
        members={located}
        places={places}
        selectedId={selected?.id ?? null}
        selectedPlaceId={highlightedPlaceId}
        focus={focus}
        draft={draft}
        onSelectMember={setFocusedId}
        onSelectPlace={(placeId) => setPlaceSheet({ mode: 'details', placeId })}
        // Press and hold anywhere: the coordinate is the press, and the sheet
        // asks what it is. Only offered to someone in a family, because
        // `saved_places.family_id` is not null and has nothing to point at.
        onLongPress={(coordinates) => {
          if (hasFamily) openPlaceForm(coordinates);
        }}
      />

      <View style={[styles.bottom, { paddingBottom: clearance }]} pointerEvents="box-none">
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={t('places.addA11y')}
          accessibilityState={{ disabled: !hasFamily || !seedCoordinates }}
          disabled={!hasFamily || !seedCoordinates}
          onPress={() => seedCoordinates && openPlaceForm(seedCoordinates)}
          // A secondary action next to "Locate me", so it takes the lighter
          // feedback and the surface fill rather than the brand green.
          feedback="tap"
          style={[
            styles.placeButton,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              opacity: hasFamily && seedCoordinates ? 1 : 0.5,
            },
          ]}>
          <Ionicons name="bookmark-outline" size={20} color={colors.accent} />
        </PressableScale>

        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={t('map.locateA11y')}
          accessibilityState={{ disabled: !canShare || isSyncing, busy: isSyncing }}
          disabled={!canShare || isSyncing}
          onPress={() => void syncNow()}
          // The same forced write — and so the same weight — as Home's "Locate".
          feedback="press"
          style={[
            styles.locateButton,
            { backgroundColor: canShare ? colors.primary : colors.surfaceMuted },
          ]}>
          {isSyncing ? (
            <ActivityIndicator color={colors.onPrimary} />
          ) : (
            <Ionicons
              name="locate"
              size={22}
              color={canShare ? colors.onPrimary : colors.textTertiary}
            />
          )}
        </PressableScale>

        {status ? (
          <Card style={styles.statusCard}>
            <Ionicons
              name={status.icon}
              size={16}
              color={status.tone === 'danger' ? colors.danger : colors.textTertiary}
            />
            <Text
              variant="caption"
              color={status.tone === 'danger' ? 'danger' : 'textSecondary'}
              style={styles.statusText}>
              {status.message}
            </Text>
          </Card>
        ) : null}

        <MemberDrawer
          members={members}
          selected={selected}
          focusedId={focused?.id ?? null}
          currentUserId={user?.id}
          expanded={isDrawerExpanded}
          onToggleExpanded={() => setIsDrawerExpanded((previous) => !previous)}
          // Tapping the centred member again releases the focus, which is the
          // only way back to the family-wide framing.
          onSelect={(memberId) => setFocusedId(focused?.id === memberId ? null : memberId)}
          isLoading={isLoading}
          hasFamily={hasFamily}
        />
      </View>

      {/*
        One sheet for the whole flow. `onEdit` and `onRequestDelete` change the
        *mode* rather than opening anything, which is what keeps a second
        `Modal` off the screen.
      */}
      <PlaceSheet
        state={placeSheet}
        places={places}
        currentUserId={user?.id}
        isPremium={isPremium}
        onUpgrade={() => {
          // Closed first: the paywall is a modal, and presenting it over a live
          // `Sheet` is the same two-modals-in-one-frame problem this whole
          // panel exists to avoid.
          closePlaceSheet();
          router.push('/premium');
        }}
        getMember={getMember}
        onClose={closePlaceSheet}
        onEdit={(place) => openPlaceForm({ latitude: place.latitude, longitude: place.longitude }, place)}
        onRequestDelete={(place) => setPlaceSheet({ mode: 'delete', placeId: place.id })}
        onSubmit={(placeId, input) => (placeId ? editPlace(placeId, input) : savePlace(input))}
        /*
          Closing is the screen's job, not the panel's: a successful delete
          removes the row the panel is describing, so the confirmation unmounts
          before its own `await` returns and would never get to close anything.
        */
        onDelete={async (placeId) => {
          const failure = await deletePlace(placeId);

          if (!failure) closePlaceSheet();

          return failure;
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  bottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    gap: Spacing.md,
  },
  locateButton: {
    width: 52,
    height: 52,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-end',
    ...Shadow.floating,
  },
  // Smaller than "Locate me" and outlined rather than filled: saving a place is
  // the secondary of the two controls, and only one of them is the brand green.
  placeButton: {
    width: 44,
    height: 44,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-end',
    ...Shadow.floating,
  },
  statusCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  statusText: { flex: 1 },
});
