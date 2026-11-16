import { abs, compare, subtract, type Money } from '../money';
import { distanceMetres } from '../distance';
import { metresBetween, normaliseName } from './identity';
import type { GeoPosition } from './types';

/**
 * Listed places to stay, and how they compare - deterministic, and nowhere else.
 *
 * A listing is a hotel an open map knows about: a name and a point, with no
 * price. This module answers the questions the stays page asks of one - how
 * far it is from the centre, which priced stay (if any) it is, and how its
 * price compares with the stay the traveller has selected - so no component
 * ever does that arithmetic inline.
 */

/** A box on the globe, in degrees. */
export interface StayArea {
  readonly south: number;
  readonly west: number;
  readonly north: number;
  readonly east: number;
}

/** Longest a stays area may be on a side: a city, never a country's worth of hotels. */
export const MAX_AREA_RADIUS_KM = 25;

/**
 * The box around a city centre, `radiusKm` each way.
 *
 * A degree of latitude is about 111 km everywhere; a degree of longitude
 * shrinks with the cosine of the latitude. Clamped so a box near a pole or
 * the antimeridian stays a valid box rather than wrapping.
 */
export function areaAround(centre: GeoPosition, radiusKm: number): StayArea {
  if (!Number.isFinite(radiusKm) || radiusKm <= 0 || radiusKm > MAX_AREA_RADIUS_KM) {
    throw new RangeError(`areaAround() needs a radius between 0 and ${MAX_AREA_RADIUS_KM} km`);
  }

  const dLat = radiusKm / 111.32;
  const cosine = Math.max(0.05, Math.cos((centre.latitude * Math.PI) / 180));
  const dLon = radiusKm / (111.32 * cosine);
  const round = (value: number) => Math.round(value * 10_000) / 10_000;

  return {
    south: round(Math.max(-90, centre.latitude - dLat)),
    north: round(Math.min(90, centre.latitude + dLat)),
    west: round(Math.max(-180, centre.longitude - dLon)),
    east: round(Math.min(180, centre.longitude + dLon)),
  };
}

/** Whole metres from the centre; the figure every row and pin shows. */
export function distanceFromCentre(centre: GeoPosition, position: GeoPosition): number {
  return distanceMetres(centre, position);
}

/** Two records of one hotel are at most this far apart. */
const SAME_PLACE_METRES = 150;

/**
 * Which of the priced stays a listing is, if any.
 *
 * Same distinguishing name and within 150 m. A name alone is not enough -
 * there is a Hotel Central in every city - and a position alone is not
 * either, because two hotels share a building more often than one would
 * think. Returns the key of the first match, or null.
 */
export function matchListing<
  T extends { readonly name: string; readonly position: GeoPosition | null },
>(
  listing: { readonly name: string; readonly position: GeoPosition },
  stays: ReadonlyMap<string, T>,
): string | null {
  const name = normaliseName(listing.name);
  if (!name) return null;

  for (const [key, stay] of stays) {
    if (!stay.position) continue;
    if (normaliseName(stay.name) !== name) continue;
    if (metresBetween(listing.position, stay.position) <= SAME_PLACE_METRES) return key;
  }

  return null;
}

export type PriceDifference =
  | { readonly kind: 'more'; readonly amount: Money }
  | { readonly kind: 'less'; readonly amount: Money }
  | { readonly kind: 'same' };

/**
 * How one stay's price compares with the selected one.
 *
 * Only when **both** prices are known and in the same currency: a missing
 * price is not zero, and converting here would be a second opinion about a
 * rate `src/core/fx.ts` owns. Null in every other case, and the page then
 * says nothing about the difference rather than guessing at it.
 */
export function priceDifference(
  selected: Money | null,
  other: Money | null,
): PriceDifference | null {
  if (!selected || !other || selected.currency !== other.currency) return null;

  const order = compare(other, selected);
  if (order === 0) return { kind: 'same' };

  const amount = abs(subtract(other, selected));
  return order > 0 ? { kind: 'more', amount } : { kind: 'less', amount };
}
