/**
 * The map itself, on web.
 *
 * `react-native-maps` has no web implementation — its own `MapView.web.ts`
 * re-exports react-native-web's `UnimplementedView`, and `Marker` reaches for
 * codegen'd native components that do not exist in a browser bundle. Importing
 * the native file here would therefore break the web build, not degrade it,
 * which is why this is a platform file rather than a branch inside one.
 *
 * So web draws the same map from the layer underneath an SDK: OpenStreetMap
 * raster tiles, laid out against the Web-Mercator grid that `toWorldPoint`
 * projects into. That is real cartography — streets, districts, city names —
 * from the same `regionForLocations` framing the native map animates to, with
 * `MemberPin` positioned by the same anchor.
 *
 * What it does not have is a *camera* gesture: the framing is derived from the
 * family and from the drawer's selection, and there is no pan or pinch. Adding
 * them would mean owning a camera state that the native map gets from its SDK
 * for free, and the two would then disagree about what the map is showing.
 *
 * The one gesture it does carry is press-and-hold, because that is how a saved
 * place gets its coordinates and the feature would otherwise be native-only.
 * It is not a camera gesture — nothing about the view changes — so it costs
 * none of the above.
 *
 * Tiles come straight from `tile.openstreetmap.org`, whose usage policy covers
 * a prototype and not a shipped app — a real deployment needs its own tile host
 * (or the native path, which is where the product actually lives).
 */

import { Image } from 'expo-image';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  MEMBER_PIN_ANCHOR,
  MEMBER_PIN_SIZE,
  MemberPin,
} from '@/components/map/member-pin';
import { PLACE_PIN_ANCHOR, PLACE_PIN_SIZE, PlacePin } from '@/components/map/place-pin';
import { PressableScale } from '@/components/ui/pressable-scale';
import { Text } from '@/components/ui/text';
import { memberName } from '@/data/format';
import {
  fromWorldPoint,
  regionForLocations,
  toWorldPoint,
  type MapRegion,
} from '@/data/geo';
import { useTheme } from '@/hooks/use-theme';
import { useTranslation } from '@/hooks/use-translation';
import { Radius, Spacing } from '@/theme';

import type { FamilyMapProps } from './family-map.types';

/** Every raster scheme in use cuts the world into 256 px squares. */
const TILE_SIZE = 256;

/** OSM publishes no tiles past 19, and 2 is the first zoom worth showing. */
const MIN_ZOOM = 2;
const MAX_ZOOM = 19;

/** What the map shows when nobody in the family is sharing a position. */
const WORLD: MapRegion = {
  latitude: 20,
  longitude: 0,
  latitudeDelta: 120,
  longitudeDelta: 340,
};

type Size = { width: number; height: number };

/** The largest whole tile zoom at which `region` still fits inside `size`. */
function zoomForRegion(region: MapRegion, size: Size): number {
  const north = toWorldPoint({
    latitude: region.latitude + region.latitudeDelta / 2,
    longitude: region.longitude,
  });
  const south = toWorldPoint({
    latitude: region.latitude - region.latitudeDelta / 2,
    longitude: region.longitude,
  });

  // Guarded against zero: a region with no span would ask for infinite zoom.
  const worldHeight = Math.max(Math.abs(south.y - north.y), 1e-9);
  const worldWidth = Math.max(region.longitudeDelta / 360, 1e-9);

  const fits = Math.min(
    Math.log2(size.width / (TILE_SIZE * worldWidth)),
    Math.log2(size.height / (TILE_SIZE * worldHeight)),
  );

  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.floor(fits)));
}

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
  const { colors } = useTheme();
  const i18n = useTranslation();

  // Tiles are placed in pixels, so nothing can be drawn until the view has some.
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });

  /*
    Members frame the camera; places only do so when nobody is sharing at all —
    the same rule the native map follows, and for the same reason.
  */
  const positions = members.map((member) => member.location!);
  const region =
    regionForLocations(positions.length > 0 ? positions : places, focus) ?? WORLD;
  const isMeasured = size.width > 0 && size.height > 0;

  const zoom = isMeasured ? zoomForRegion(region, size) : MIN_ZOOM;
  // Width of the whole world at this zoom, in pixels.
  const worldScale = TILE_SIZE * 2 ** zoom;
  const centre = toWorldPoint(region);

  // Top-left of the viewport, in world pixels — every tile and every pin is
  // placed by subtracting it.
  const originX = centre.x * worldScale - size.width / 2;
  const originY = centre.y * worldScale - size.height / 2;

  const tileCount = 2 ** zoom;
  const tiles: { key: string; x: number; y: number; left: number; top: number }[] = [];

  if (isMeasured) {
    const firstX = Math.floor(originX / TILE_SIZE);
    const lastX = Math.floor((originX + size.width) / TILE_SIZE);
    // Mercator has no tiles above or below its own limits, so y is clamped
    // where x merely wraps.
    const firstY = Math.max(0, Math.floor(originY / TILE_SIZE));
    const lastY = Math.min(tileCount - 1, Math.floor((originY + size.height) / TILE_SIZE));

    for (let x = firstX; x <= lastX; x += 1) {
      for (let y = firstY; y <= lastY; y += 1) {
        tiles.push({
          key: `${x}:${y}`,
          x: ((x % tileCount) + tileCount) % tileCount,
          y,
          left: x * TILE_SIZE - originX,
          top: y * TILE_SIZE - originY,
        });
      }
    }
  }

  return (
    <View
      style={[styles.map, { backgroundColor: colors.mapCanvas }]}
      onLayout={(event) => setSize(event.nativeEvent.layout)}>
      {tiles.map((tile) => (
        <Image
          key={tile.key}
          source={{ uri: `https://tile.openstreetmap.org/${zoom}/${tile.x}/${tile.y}.png` }}
          style={[styles.tile, { left: tile.left, top: tile.top }]}
          contentFit="fill"
          // Tiles are immutable for a given z/x/y, so a fade would only ever
          // fade in something already on disk.
          transition={0}
        />
      ))}

      {isMeasured
        ? members.map((member) => {
            const point = toWorldPoint(member.location!);

            return (
              <PressableScale
                key={member.id}
                accessibilityRole="button"
                accessibilityLabel={memberName(i18n, member)}
                accessibilityState={{ selected: member.id === selectedId }}
                onPress={() => onSelectMember(member.id)}
                style={[
                  styles.pin,
                  {
                    left: point.x * worldScale - originX - MEMBER_PIN_SIZE.width * MEMBER_PIN_ANCHOR.x,
                    top: point.y * worldScale - originY - MEMBER_PIN_SIZE.height * MEMBER_PIN_ANCHOR.y,
                    // The selected pin's halo has to overlap its neighbours
                    // rather than be overlapped by them.
                    zIndex: member.id === selectedId ? 2 : 1,
                  },
                ]}>
                <MemberPin member={member} selected={member.id === selectedId} />
              </PressableScale>
            );
          })
        : null}

      {/*
        Press and hold to drop a place, the same gesture the native map offers.
        Here it arrives as pixels rather than as a coordinate, so it is
        un-projected against the very origin the tiles above were laid from —
        `fromWorldPoint` exists for this one call. It sits under the pins so a
        held finger on somebody's face is still that pin's own gesture.
      */}
      {isMeasured ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={i18n.t('places.addByPressA11y')}
          onLongPress={(event) =>
            onLongPress(
              fromWorldPoint({
                x: (originX + event.nativeEvent.locationX) / worldScale,
                y: (originY + event.nativeEvent.locationY) / worldScale,
              }),
            )
          }
          style={StyleSheet.absoluteFill}
        />
      ) : null}

      {isMeasured
        ? places.map((place) => {
            const point = toWorldPoint(place);

            return (
              <PressableScale
                key={place.id}
                accessibilityRole="button"
                accessibilityLabel={place.title}
                accessibilityState={{ selected: place.id === selectedPlaceId }}
                onPress={() => onSelectPlace(place.id)}
                style={[
                  styles.pin,
                  {
                    left: point.x * worldScale - originX - PLACE_PIN_SIZE.width * PLACE_PIN_ANCHOR.x,
                    top: point.y * worldScale - originY - PLACE_PIN_SIZE.height * PLACE_PIN_ANCHOR.y,
                  },
                ]}>
                <PlacePin
                  category={place.category}
                  title={place.title}
                  selected={place.id === selectedPlaceId}
                />
              </PressableScale>
            );
          })
        : null}

      {isMeasured && draft
        ? (() => {
            const point = toWorldPoint(draft);

            return (
              <View
                pointerEvents="none"
                style={[
                  styles.pin,
                  {
                    left: point.x * worldScale - originX - PLACE_PIN_SIZE.width * PLACE_PIN_ANCHOR.x,
                    top: point.y * worldScale - originY - PLACE_PIN_SIZE.height * PLACE_PIN_ANCHOR.y,
                    zIndex: 3,
                  },
                ]}>
                <PlacePin draft />
              </View>
            );
          })()
        : null}

      {/* Required by the tile licence, and the only chrome the canvas carries. */}
      <View style={[styles.attribution, { backgroundColor: colors.surface }]} pointerEvents="none">
        <Text variant="label" color="textTertiary">
          © OpenStreetMap
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  map: { ...StyleSheet.absoluteFill, overflow: 'hidden' },
  tile: { position: 'absolute', width: TILE_SIZE, height: TILE_SIZE },
  pin: { position: 'absolute' },
  attribution: {
    position: 'absolute',
    left: Spacing.sm,
    top: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: Radius.pill,
    opacity: 0.9,
  },
});
