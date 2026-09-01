/**
 * Saved places, and the one question they exist to answer: who is at one.
 *
 * `saved_places` is the first table that can give the app a place *name*, so
 * this is the first derivation allowed to print one. Everything here is a fold
 * over rows the client already holds — a member's `locations` row against the
 * family's places — because "at" is a distance, and a distance recomputed is
 * always right where a stored one is wrong the moment somebody moves. That is
 * also why there is no visit log behind any of it.
 *
 * Pure, like the rest of `data/`: the `Translator` arrives as an argument
 * rather than being read from ambient state, so a sentence can be built for any
 * language without this module knowing which one is current.
 */

import { getDistanceInMeters, type Coordinates } from '@/data/geo';
import type { FamilyMember, PlaceCategory, SavedPlace } from '@/data/types';
import type { Translator } from '@/i18n';

/**
 * The five values `saved_places_category_valid` allows, in the order the picker
 * offers them. One row per (member, category) is what caps a member at five
 * saved places, so this list is the ceiling as much as it is the vocabulary.
 */
export const PLACE_CATEGORIES: readonly PlaceCategory[] = [
  'home',
  'school',
  'work',
  'leisure',
  'park',
];

/**
 * How close counts as "at" a place, in metres.
 *
 * The same order as the tracker's write threshold, and deliberately so: a fix
 * that moved less than 100 m does not get written, so a radius tighter than
 * that would flicker on and off with whatever the last stored position happened
 * to be. It is a building and its car park, not a doorway.
 */
export const PROXIMITY_RADIUS_M = 100;

/**
 * Categories whose owner is not part of what the place is called.
 *
 * A park belongs to nobody, so "Mehmet at Beach Park" is the whole sentence;
 * a home belongs to somebody, and "Sami at Home" would be the wrong home unless
 * it is Sami's. That split is the only thing the category decides at read time.
 */
const PUBLIC_CATEGORIES: readonly PlaceCategory[] = ['leisure', 'park'];

export function isPublicPlace(category: PlaceCategory): boolean {
  return PUBLIC_CATEGORIES.includes(category);
}

const CATEGORY_KEYS = {
  home: 'places.categoryHome',
  school: 'places.categorySchool',
  work: 'places.categoryWork',
  leisure: 'places.categoryLeisure',
  park: 'places.categoryPark',
} as const;

/** "Home", "School" — what the category is called, never what the place is. */
export function placeCategoryLabel(i18n: Translator, category: PlaceCategory): string {
  return i18n.t(CATEGORY_KEYS[category]);
}

/** A place and how far the position asked about was from it. */
export type PlaceProximity = {
  place: SavedPlace;
  /** Metres, great-circle — the same measure the tracker's threshold uses. */
  distance: number;
};

/**
 * The closest saved place within `PROXIMITY_RADIUS_M`, or null.
 *
 * Nearest rather than first: two places can legitimately overlap — a home and
 * the park across the road — and the closer one is the better answer.
 */
export function nearestPlace(
  places: SavedPlace[],
  position: Coordinates,
  radius = PROXIMITY_RADIUS_M,
): PlaceProximity | null {
  return places.reduce<PlaceProximity | null>((closest, place) => {
    const distance = getDistanceInMeters(position, place);

    if (distance > radius) return closest;

    return !closest || distance < closest.distance ? { place, distance } : closest;
  }, null);
}

/** A member, the place they are at, and how close they are to its centre. */
export type MemberAtPlace = PlaceProximity & { member: FamilyMember };

/**
 * Everyone currently standing at a saved place.
 *
 * Only members carrying a `locations` row can be placed, and the caller decides
 * how fresh that row has to be — this does not test presence, because "who is
 * at the shop" and "whose pin can be trusted" are two different questions and
 * the Home pill answers them in that order.
 */
export function membersAtPlaces(members: FamilyMember[], places: SavedPlace[]): MemberAtPlace[] {
  if (places.length === 0) return [];

  return members.flatMap((member) => {
    if (!member.location) return [];

    const match = nearestPlace(places, member.location);

    return match ? [{ member, ...match }] : [];
  });
}

export type PlaceSentenceInput = {
  /** Who is there, already resolved to how they should be addressed. */
  name: string;
  place: SavedPlace;
  /** Who saved it, or null when they are no longer in the roster. */
  ownerName: string | null;
  /** True when the person reading this is the one who saved the place. */
  isOwnedByViewer: boolean;
  /** True when the person who is there is the one who saved it. */
  isOwnedBySubject: boolean;
};

/**
 * "Sami at Mehmet's Home", "Mehmet at Beach Park", "Sami at Work".
 *
 * Three catalog keys rather than one sentence assembled here: the possessive is
 * a suffix in English, a preposition in French and a case ending in Turkish, so
 * where the owner's name goes is the translator's business. Which of the three
 * applies is not — that is decided by the category and by who is reading.
 */
export function placeSentence(i18n: Translator, input: PlaceSentenceInput): string {
  const { name, place, ownerName, isOwnedByViewer, isOwnedBySubject } = input;

  // Nobody's name improves "at Beach Park", and a place you are standing at
  // that you saved yourself is just "at Work".
  if (isPublicPlace(place.category) || isOwnedBySubject || !ownerName) {
    return i18n.t('places.at', { name, place: place.title });
  }

  if (isOwnedByViewer) {
    return i18n.t('places.atYours', { name, place: place.title });
  }

  return i18n.t('places.atOwned', { name, owner: ownerName, place: place.title });
}
