import type { Coordinates } from '@/data/geo';
import type { FamilyMember, SavedPlace } from '@/data/types';

export type FamilyMapProps = {
  /**
   * Only members carrying a `locations` row — a pin exists because a row does,
   * so `member.location` is non-null for everyone in this list and the map is
   * allowed to assert it.
   */
  members: FamilyMember[];
  /** Every saved place in the family; all of them are visible to all of them. */
  places: SavedPlace[];
  /** Whose pin wears the halo. Resolved by the screen, never guessed here. */
  selectedId: string | null;
  /** Which place pin is open in the sheet, if any. */
  selectedPlaceId: string | null;
  /**
   * Set once someone has been picked from the drawer: the camera centres on
   * this coordinate and widens to keep everyone else in frame. Null is the
   * family-wide view the screen opens with.
   */
  focus: Coordinates | null;
  /**
   * The pin the composer is currently placing — a proposal with no row behind
   * it yet, drawn hollow so it reads as one.
   */
  draft: Coordinates | null;
  onSelectMember: (memberId: string) => void;
  onSelectPlace: (placeId: string) => void;
  /** Where the user pressed and held: how a place gets its coordinates. */
  onLongPress: (coordinates: Coordinates) => void;
};
