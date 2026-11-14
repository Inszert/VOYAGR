/**
 * Where the planet looks when it opens.
 *
 * The terminator follows the real clock, which is true and stays. What the
 * opening camera may do is choose which half of the planet is on screen: the
 * home airport has to be visible, and when it can be arranged most of what is
 * visible should be in daylight. Pure, with the sun passed in, so a test can
 * hold any hour.
 */

const RADIANS = Math.PI / 180;

export interface LngLat {
  readonly lng: number;
  readonly lat: number;
}

export interface Sun {
  /** The longitude the sun is overhead, degrees. */
  readonly longitude: number;
  /** The latitude the sun is overhead, degrees. */
  readonly declination: number;
}

function wrap(longitude: number): number {
  return ((((longitude + 180) % 360) + 360) % 360) - 180;
}

/** The great-circle distance between two places, in degrees. */
export function angularDistance(a: LngLat, b: LngLat): number {
  const cosine =
    Math.sin(a.lat * RADIANS) * Math.sin(b.lat * RADIANS) +
    Math.cos(a.lat * RADIANS) * Math.cos(b.lat * RADIANS) * Math.cos((a.lng - b.lng) * RADIANS);

  return Math.acos(Math.max(-1, Math.min(1, cosine))) / RADIANS;
}

/**
 * The share of the visible disc that is in daylight, 0 to 1.
 *
 * Two hemispheres - the one facing the viewer and the one facing the sun -
 * overlap in a lune, and `d` degrees between their centres leaves
 * `(180 - d) / 180` of the viewer's disc lit.
 */
export function daylitShare(centre: LngLat, sun: Sun): number {
  const d = angularDistance(centre, { lng: sun.longitude, lat: sun.declination });
  return (180 - d) / 180;
}

/** Whether it is daytime at a place: the sun is less than 90 degrees from it. */
export function isDaylit(place: LngLat, sun: Sun): boolean {
  return angularDistance(place, { lng: sun.longitude, lat: sun.declination }) < 90;
}

/** How far the home airport may drift from the middle of the disc. */
export const HOME_MAX_OFFSET = 55;
/** The daylit share the opening view aims for. */
export const DAYLIT_TARGET = 0.6;

/**
 * The longitude and latitude the planet opens on.
 *
 * Starts from the home airport (its latitude nudged south, as the stage has
 * always done) and, when that view is mostly night, turns the planet towards
 * the sun along the longitude - as far as needed to reach the target share,
 * and no further than keeps the home airport within `HOME_MAX_OFFSET` degrees
 * of the middle. If the home airport is itself in night there is nothing true
 * to turn towards, and the view stays on it.
 */
export function restingCentre(input: {
  readonly home: LngLat;
  readonly sun: Sun;
  /** Degrees south of the airport to look, as before. */
  readonly southNudge?: number;
}): [number, number] {
  const lat = Math.max(-30, Math.min(30, input.home.lat - (input.southNudge ?? 12)));
  const start: LngLat = { lng: input.home.lng, lat };

  if (daylitShare(start, input.sun) >= DAYLIT_TARGET) return [start.lng, start.lat];
  if (!isDaylit(input.home, input.sun)) return [start.lng, start.lat];

  // Which way round to the sun's longitude is shorter.
  const gap = wrap(input.sun.longitude - input.home.lng);
  const direction = gap >= 0 ? 1 : -1;

  let best = start;
  let bestShare = daylitShare(start, input.sun);

  for (let step = 1; step <= Math.abs(gap); step += 1) {
    const candidate: LngLat = { lng: wrap(input.home.lng + direction * step), lat };
    if (angularDistance(candidate, input.home) > HOME_MAX_OFFSET) break;

    const share = daylitShare(candidate, input.sun);
    if (share > bestShare) {
      best = candidate;
      bestShare = share;
    }
    if (share >= DAYLIT_TARGET) break;
  }

  return [best.lng, best.lat];
}
