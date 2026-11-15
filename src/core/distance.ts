/**
 * Distance between two points on the Earth, for "x km from the centre".
 *
 * Pure and exact enough for a walk across a city: the haversine formula on a
 * sphere is within about 0.5% of the true distance, which is a few hundred
 * metres at the 30 km we ever ask about. Returned in whole metres so the figure
 * is the same on every machine and can be compared and cached as an integer.
 */

export interface Coordinates {
  readonly latitude: number;
  readonly longitude: number;
}

/** Mean Earth radius in metres (IUGG). */
const EARTH_RADIUS_METRES = 6_371_008.8;

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function isCoordinate(point: Coordinates): boolean {
  return (
    Number.isFinite(point.latitude) &&
    Number.isFinite(point.longitude) &&
    Math.abs(point.latitude) <= 90 &&
    Math.abs(point.longitude) <= 180
  );
}

/**
 * Great-circle distance in whole metres.
 *
 * Throws on a point that is not on the globe rather than returning `NaN`: a
 * distance printed from a latitude of 400 would be an invented fact.
 */
export function distanceMetres(from: Coordinates, to: Coordinates): number {
  if (!isCoordinate(from) || !isCoordinate(to)) {
    throw new RangeError('distanceMetres() requires latitudes within 90 and longitudes within 180');
  }

  const deltaLatitude = radians(to.latitude - from.latitude);
  const deltaLongitude = radians(to.longitude - from.longitude);

  const a =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(radians(from.latitude)) *
      Math.cos(radians(to.latitude)) *
      Math.sin(deltaLongitude / 2) ** 2;

  // `min` guards the rounding error that can push `a` a hair past 1 for
  // antipodal points, where `asin` of a number above 1 is `NaN`.
  return Math.round(2 * EARTH_RADIUS_METRES * Math.asin(Math.min(1, Math.sqrt(a))));
}

/**
 * Kilometres as a reader says them: "0.8 km" under ten, "12 km" from ten.
 * A tenth of a kilometre is a real difference on foot and noise by bus.
 */
export function formatKilometres(metres: number): string {
  if (!Number.isFinite(metres) || metres < 0) {
    throw new RangeError('formatKilometres() requires a non-negative distance');
  }

  // Rounded to a tenth first, so 9,999 m reads "10 km" and not "10.0 km".
  const tenths = Math.round(metres / 100);
  const text = tenths < 100 ? (tenths / 10).toFixed(1) : String(Math.round(metres / 1000));

  return `${text} km`;
}
