/**
 * The map itself, on iOS and Android: real base tiles from the platform's own
 * SDK (Apple Maps on iOS, Google Maps on Android — `react-native-maps` picks
 * the default provider, which is why neither needs an API key inside Expo Go).
 *
 * Everything drawn on it comes from a row. A `<Marker>` exists because that
 * member has a `locations` row, and it sits on the coordinates that row stores
 * — the map supplies the streets, districts and place names, so nothing here
 * has to invent a label the schema cannot give.
 *
 * The camera is entirely derived: `regionForLocations` frames whoever is
 * sharing a position, and the screen widens or re-centres that by handing down
 * a `focus`. There is no gesture state kept here — a member can pan and zoom
 * freely, and the next framing change moves the camera again.
 *
 * `family-map.web.tsx` is the same component over raster tiles; see its header
 * for why the web target cannot use this file.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import MapView, { Marker } from 'react-native-maps';

import { MEMBER_PIN_ANCHOR, MemberPin } from '@/components/map/member-pin';
import { PLACE_PIN_ANCHOR, PlacePin } from '@/components/map/place-pin';
import { memberName } from '@/data/format';
import { regionForLocations } from '@/data/geo';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/hooks/use-translation';

import type { FamilyMapProps } from './family-map.types';

/** Long enough to read as travel rather than a cut, short enough not to wait on. */
const CAMERA_DURATION_MS = 600;

export function FamilyMap({
  members,
  places,
  selectedId,
  selectedPlaceId,
  focus,
  draft,
  onSelectMember,
  onSelectPlace,
  onLongPress,
}: FamilyMapProps) {
  const { colors, scheme } = useTheme();
  const i18n = useTranslation();

  const mapRef = useRef<MapView>(null);

  /*
    Android drops any camera command sent before the map surface exists, so the
    fit has to wait for `onMapReady` — and re-run once it arrives, since the
    family has usually loaded by then.
  */
  const [isReady, setIsReady] = useState(false);

  /*
    Members frame the camera; places only do so when nobody is sharing at all.
    Folding places in unconditionally would widen the view every time somebody
    saved a spot across town — and worse, centring on a member would then grow
    the span to reach that place, which is the opposite of what focusing means.
    With no positions to frame, though, the places are the only thing on the map
    worth pointing at.
  */
  const region = useMemo(() => {
    const positions = members.map((member) => member.location!);

    return regionForLocations(positions.length > 0 ? positions : places, focus);
  }, [members, places, focus]);

  /*
    The camera follows the *values* of the frame, not the object: `useFamily`
    hands down a fresh members array on every refresh, and animating each time
    one arrives would yank the map out from under a finger that is panning it.
  */
  const latitude = region?.latitude ?? null;
  const longitude = region?.longitude ?? null;
  const latitudeDelta = region?.latitudeDelta ?? null;
  const longitudeDelta = region?.longitudeDelta ?? null;

  useEffect(() => {
    if (!isReady) return;
    if (latitude === null || longitude === null) return;
    if (latitudeDelta === null || longitudeDelta === null) return;

    mapRef.current?.animateToRegion(
      { latitude, longitude, latitudeDelta, longitudeDelta },
      CAMERA_DURATION_MS,
    );
  }, [isReady, latitude, longitude, latitudeDelta, longitudeDelta]);

  return (
    <MapView
      ref={mapRef}
      style={StyleSheet.absoluteFill}
      // Right on the first frame when the family is already loaded; when it is
      // not, the effect above animates from the default view instead, which is
      // the "fit to the family" the screen opens with.
      initialRegion={region ?? undefined}
      onMapReady={() => setIsReady(true)}
      // Press and hold is how a place gets its coordinates. The SDK hands this
      // one a real latitude and longitude, so nothing has to be un-projected.
      onLongPress={(event) => onLongPress(event.nativeEvent.coordinate)}
      // The scheme is the stored appearance preference, not the OS one.
      userInterfaceStyle={scheme}
      loadingEnabled
      loadingBackgroundColor={colors.mapCanvas}
      loadingIndicatorColor={colors.primary}
      /*
        The app draws its own pin for every member including the signed-in one,
        so the SDK's blue dot would be a second marker for the same person —
        and one placed at the live device fix rather than at the row everybody
        else can actually see.
      */
      showsUserLocation={false}
      showsMyLocationButton={false}
      // "Locate me" and the drawer are the screen's controls; the SDK's own
      // chrome would sit under the floating tab bar and duplicate them.
      showsCompass={false}
      toolbarEnabled={false}
      rotateEnabled={false}
      pitchEnabled={false}>
      {members.map((member) => (
        <Marker
          key={member.id}
          identifier={member.id}
          coordinate={{
            latitude: member.location!.latitude,
            longitude: member.location!.longitude,
          }}
          anchor={MEMBER_PIN_ANCHOR}
          // The selected pin wears a halo, which has to overlap its neighbours
          // rather than be overlapped by them. Both member layers sit above
          // both place layers below — a place is *where* somebody is, so the
          // person is what you are looking for when the two coincide.
          zIndex={member.id === selectedId ? 3 : 2}
          accessibilityLabel={memberName(i18n, member)}
          onPress={() => onSelectMember(member.id)}
          /*
            A custom marker view is rasterised once and then frozen unless this
            is on, and the avatar is a *network* memoji — freezing early is how
            a pin ends up stuck on its initials. A family is capped at ten
            members by the database, so the redraw cost this buys is bounded.
          */
          tracksViewChanges>
          <MemberPin member={member} selected={member.id === selectedId} />
        </Marker>
      ))}

      {places.map((place) => (
        <Marker
          /*
            Nothing in a place pin arrives over the network, so it can be
            rasterised once and frozen — but frozen means an edited title would
            keep the old label. The key carries everything the pin draws, so
            changing any of it re-mounts the marker instead.
          */
          key={`${place.id}:${place.category}:${place.title}:${place.id === selectedPlaceId}`}
          identifier={place.id}
          coordinate={{ latitude: place.latitude, longitude: place.longitude }}
          anchor={PLACE_PIN_ANCHOR}
          // Under every member pin — see the member layer above. Zero rather
          // than a negative: the platform SDKs clamp a marker's zIndex at the
          // map's own overlay floor, so "below everything" is 0, not -1.
          zIndex={place.id === selectedPlaceId ? 1 : 0}
          accessibilityLabel={place.title}
          onPress={() => onSelectPlace(place.id)}
          tracksViewChanges={false}>
          <PlacePin
            category={place.category}
            title={place.title}
            selected={place.id === selectedPlaceId}
          />
        </Marker>
      ))}

      {/*
        The pin being placed. Keyed on its coordinates so moving it re-mounts
        the marker: a native marker does not always follow a changed coordinate
        prop, and a draft that lags behind the press is worse than none.
      */}
      {draft ? (
        <Marker
          key={`draft:${draft.latitude}:${draft.longitude}`}
          coordinate={draft}
          anchor={PLACE_PIN_ANCHOR}
          zIndex={4}
          accessibilityLabel={i18n.t('places.draftA11y')}
          tracksViewChanges>
          <PlacePin draft />
        </Marker>
      ) : null}
    </MapView>
  );
}
