/**
 * Geometry for the discovery globe.
 *
 * Pure, like `src/core/dates.ts`: no map library, no I/O, no rounding that
 * depends on the renderer. A route between two airports is a great circle,
 * because that is the path a flight actually takes and because a straight
 * line on a globe projection is a lie about distance that gets worse the
 * further north it goes.
 *
 * Positions are `[longitude, latitude]`, GeoJSON order, throughout.
 */

export type LngLat = readonly [number, number];

const DEGREES = Math.PI / 180;

/** Output precision. Four decimals is about ten metres, far below what a globe draws. */
const PRECISION = 1e4;

function round(value: number): number {
  return Math.round(value * PRECISION) / PRECISION;
}

/**
 * The angular distance between two positions, in radians.
 *
 * Haversine, which stays accurate for the short hops a European search is
 * full of; the spherical law of cosines loses precision under a few hundred
 * metres.
 */
export function angularDistance(from: LngLat, to: LngLat): number {
  const [lon1, lat1] = [from[0] * DEGREES, from[1] * DEGREES];
  const [lon2, lat2] = [to[0] * DEGREES, to[1] * DEGREES];

  const dLat = lat2 - lat1;
  const dLon = lon2 - lon1;

  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Great-circle distance in kilometres, on a mean-radius sphere. */
export function distanceKm(from: LngLat, to: LngLat): number {
  return round(angularDistance(from, to) * 6371.0088);
}

/**
 * Points along the great circle from `from` to `to`, inclusive of both.
 *
 * Spherical interpolation rather than lerping the coordinates: the latter
 * bends the wrong way and, across the antimeridian, goes round the world.
 */
function interpolate(from: LngLat, to: LngLat, steps: number): LngLat[] {
  const distance = angularDistance(from, to);

  if (distance < 1e-9) return [[...from], [...to]];

  const [lon1, lat1] = [from[0] * DEGREES, from[1] * DEGREES];
  const [lon2, lat2] = [to[0] * DEGREES, to[1] * DEGREES];
  const sinDistance = Math.sin(distance);

  const points: LngLat[] = [];

  for (let index = 0; index <= steps; index += 1) {
    const fraction = index / steps;
    const a = Math.sin((1 - fraction) * distance) / sinDistance;
    const b = Math.sin(fraction * distance) / sinDistance;

    const x = a * Math.cos(lat1) * Math.cos(lon1) + b * Math.cos(lat2) * Math.cos(lon2);
    const y = a * Math.cos(lat1) * Math.sin(lon1) + b * Math.cos(lat2) * Math.sin(lon2);
    const z = a * Math.sin(lat1) + b * Math.sin(lat2);

    points.push([
      round(Math.atan2(y, x) / DEGREES),
      round(Math.atan2(z, Math.sqrt(x * x + y * y)) / DEGREES),
    ]);
  }

  // The ends are the inputs exactly, not their rounded reconstruction, so a
  // route visibly starts on its airport.
  points[0] = [...from];
  points[points.length - 1] = [...to];

  return points;
}

/**
 * Split a path wherever it crosses the antimeridian.
 *
 * A line from 179 to -179 is two degrees long, but a renderer given those two
 * points draws it the other way round the planet. Cutting at the meridian and
 * restarting on the far side is what every map format expects, and it is why
 * a route is a `MultiLineString` rather than a `LineString`.
 */
export function splitAtAntimeridian(points: readonly LngLat[]): LngLat[][] {
  const segments: LngLat[][] = [];
  let current: LngLat[] = [];

  for (let index = 0; index < points.length; index += 1) {
    const point = points[index]!;
    const previous = index > 0 ? points[index - 1] : undefined;

    if (previous) {
      const delta = point[0] - previous[0];

      if (Math.abs(delta) > 180) {
        // Going west off the -180 edge when delta is positive, east off the
        // +180 edge when negative. Unwrap the far point so the crossing
        // latitude can be found on a straight segment.
        const edge = delta > 0 ? -180 : 180;
        const unwrapped = point[0] + (delta > 0 ? -360 : 360);
        const fraction = (edge - previous[0]) / (unwrapped - previous[0]);
        const latitude = round(previous[1] + fraction * (point[1] - previous[1]));

        current.push([edge, latitude]);
        segments.push(current);
        current = [[-edge, latitude]];
      }
    }

    current.push(point);
  }

  if (current.length > 1) segments.push(current);

  return segments;
}

/**
 * The great-circle route between two airports, as line segments.
 *
 * `steps` is how many pieces the arc is drawn in. Sixty-four is smooth at any
 * zoom the product uses; the number is a parameter so a test can ask for four
 * and check the arithmetic by hand.
 */
export function greatCirclePath(from: LngLat, to: LngLat, steps = 64): LngLat[][] {
  return splitAtAntimeridian(interpolate(from, to, Math.max(1, Math.floor(steps))));
}

/** The point halfway along the great circle, where a label would sit. */
export function midpoint(from: LngLat, to: LngLat): LngLat {
  return interpolate(from, to, 2)[1]!;
}
