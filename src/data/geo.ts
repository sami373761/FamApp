/**
 * Pure geography: framing a set of positions for the map camera, projecting one
 * onto the Web-Mercator world, and measuring the distance between two of them.
 *
 * The map is a real SDK now (`react-native-maps`), so it owns a viewport and
 * the old `createProjection` is gone rather than adapted — it existed only
 * because a plain `View` had no viewport, and made the family's own bounding
 * box *be* one. What the screen still has to decide is where to point the
 * camera, and that is `regionForLocations`: the box around everyone sharing a
 * position, padded, with a floor on the span so two people in one room do not
 * open at maximum zoom. Focusing one member re-centres on them and widens the
 * span to match, so re-framing never pushes another member off screen.
 *
 * The projection runs both ways. `toWorldPoint` is what lets the web map place
 * a pin and a tile against one ruler; `fromWorldPoint` is what turns a pixel
 * that was long-pressed back into the coordinate a saved place is filed under.
 */

/**
 * A bare position. `MemberLocation` satisfies it structurally, so a stored row
 * and a fresh device fix can be compared without either being converted.
 */
export type Coordinates = { latitude: number; longitude: number };

/** What `react-native-maps` calls a region: a centre plus a span, in degrees. */
export type MapRegion = Coordinates & {
  latitudeDelta: number;
  longitudeDelta: number;
};

/**
 * Multiplier on the fitted span. The outermost pin is drawn *above* its
 * coordinate and the drawer covers the bottom of the screen, so a region that
 * exactly bounds the family would clip somebody.
 */
const REGION_PADDING = 1.8;

/**
 * Roughly 400 m. Without a floor, a family standing in one room produces a
 * near-zero span and the camera dives to its maximum zoom, where a real map
 * shows building outlines and no context at all.
 */
const MIN_SPAN_DEGREES = 0.004;

/** Mercator runs out before the poles do; a region wider than this is a world view. */
const MAX_LATITUDE_DELTA = 150;

/**
 * Frames every supplied position, or null when there are none to frame.
 *
 * Null is the honest answer for a family that is not sharing anything: the map
 * still renders, it simply has no reason to move, and inventing a centre would
 * point it at whatever coordinate happened to be handy.
 *
 * `focus` is what the member drawer means by "centre on this person": that
 * coordinate takes the centre and the span grows to twice the distance to
 * whoever is furthest from it. Without it the centre is the midpoint of the
 * bounding box, where the same formula reduces to the box's own span.
 */
export function regionForLocations(
  locations: Coordinates[],
  focus?: Coordinates | null,
): MapRegion | null {
  if (locations.length === 0) return null;

  const latitudes = locations.map((location) => location.latitude);
  const longitudes = locations.map((location) => location.longitude);

  const latitude = focus ? focus.latitude : (Math.min(...latitudes) + Math.max(...latitudes)) / 2;
  const longitude = focus
    ? focus.longitude
    : (Math.min(...longitudes) + Math.max(...longitudes)) / 2;

  // A degree of longitude shrinks towards the poles; without this the metric
  // floor below would be far tighter east-west than north-south at high latitudes.
  const longitudeScale = Math.max(Math.cos((latitude * Math.PI) / 180), 0.01);

  const latitudeSpan = 2 * Math.max(...latitudes.map((value) => Math.abs(value - latitude)));
  const longitudeSpan = 2 * Math.max(...longitudes.map((value) => Math.abs(value - longitude)));

  return {
    latitude,
    longitude,
    latitudeDelta: Math.min(
      Math.max(latitudeSpan * REGION_PADDING, MIN_SPAN_DEGREES),
      MAX_LATITUDE_DELTA,
    ),
    longitudeDelta: Math.min(
      Math.max(longitudeSpan * REGION_PADDING, MIN_SPAN_DEGREES / longitudeScale),
      360,
    ),
  };
}

/** Normalised Web-Mercator world coordinates: 0,0 is top-left, 1,1 bottom-right. */
export type WorldPoint = { x: number; y: number };

/** Where Web-Mercator stops: the projection is infinite at the poles. */
const MERCATOR_MAX_LATITUDE = 85.05112878;

/**
 * Projects a position into the unit square every raster tile scheme is cut
 * from — tile `z/x/y` covers `x/2**z … (x+1)/2**z` of it. That is what lets the
 * web map place a pin and a tile against the same ruler; the native map does
 * its own projection and never calls this.
 */
export function toWorldPoint({ latitude, longitude }: Coordinates): WorldPoint {
  const clamped = Math.max(-MERCATOR_MAX_LATITUDE, Math.min(MERCATOR_MAX_LATITUDE, latitude));
  const sine = Math.sin((clamped * Math.PI) / 180);

  return {
    x: (longitude + 180) / 360,
    // Latitude grows north, world y grows downward.
    y: 0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI),
  };
}

/**
 * The inverse of `toWorldPoint`: a point on the unit square back to a position.
 *
 * Only the web map needs this, and only because it is the one surface where a
 * touch arrives as pixels rather than as a coordinate — `react-native-maps`
 * hands its own `onLongPress` a latitude and longitude already. Long-pressing
 * the tile grid to drop a saved place is what made a second direction
 * necessary; nothing else reads it.
 */
export function fromWorldPoint({ x, y }: WorldPoint): Coordinates {
  return {
    latitude: (360 / Math.PI) * (Math.atan(Math.exp((0.5 - y) * 2 * Math.PI)) - Math.PI / 4),
    // The world wraps east-west, so a drag past the antimeridian still lands
    // on a real longitude rather than on 200 degrees east.
    longitude: ((((x * 360) % 360) + 360) % 360) - 180,
  };
}

/** Mean Earth radius (IUGG), in metres. */
const EARTH_RADIUS_M = 6371008.8;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * Great-circle distance between two positions, in metres (Haversine).
 *
 * This is what decides whether a fresh GPS fix is worth a database write: the
 * tracker compares it against its threshold and skips the upsert for anything
 * smaller, so a phone sitting on a table overnight writes nothing. A spherical
 * Earth is off by ~0.5% at worst, which at the scale of a movement threshold is
 * far below the noise of the fix itself.
 */
export function getDistanceInMeters(from: Coordinates, to: Coordinates): number {
  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);
  const deltaLat = lat2 - lat1;
  const deltaLng = toRadians(to.longitude - from.longitude);

  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * "41.0082, 28.9784" — all `locations` can say about where somebody is.
 *
 * Takes bare `Coordinates` rather than a `MemberLocation` so a saved place can
 * print its pin the same way: a place has a name *and* a position, and the
 * sheet that offers to move it has to show which position it is moving.
 */
export function formatCoordinates(position: Coordinates): string {
  return `${position.latitude.toFixed(4)}, ${position.longitude.toFixed(4)}`;
}
