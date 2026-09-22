import type { IsoDate } from '@/core/trip/types';
import { sunLatitude } from './seasons';

/**
 * Where the sun is, and therefore which half of the planet is dark.
 *
 * The globe's seasonal model answers "what time of year is it" from a date.
 * This answers "what time of day is it" from a clock, and the two together are
 * what make a drawn planet read as a planet: the ice belongs to the season,
 * the lit half belongs to the hour.
 *
 * Pure, like everything else here. The clock is read by the component and
 * passed in, so the night can be computed for any instant and asserted for
 * several without waiting for them.
 *
 * **This is astronomy, not a claim about a place.** Nothing on the page is
 * priced, ranked or filtered by it. It is the same class of thing as the
 * coastline: drawn because it is true, and carrying no product meaning.
 */

const DEGREES = Math.PI / 180;

/** Minutes in a day, which is how far the sun travels around it. */
const DAY_MINUTES = 24 * 60;

/**
 * How close to an equinox the declination is allowed to get.
 *
 * At exactly zero the terminator runs through both poles and the dark region
 * stops being a cap around one of them, which is the one shape the polygon
 * below cannot express. Half a degree of declination is nine minutes of a
 * year and is invisible on a globe; a terminator that degenerates into a
 * rectangle across the whole map for a day twice a year is not.
 */
const MINIMUM_DECLINATION = 0.5;

export interface SunPosition {
  /** The latitude the sun is overhead, in degrees. */
  readonly declination: number;
  /** The longitude the sun is overhead, in degrees, -180 to 180. */
  readonly longitude: number;
}

/** Wrap a longitude into -180 to 180. */
function wrap(longitude: number): number {
  return ((((longitude + 180) % 360) + 360) % 360) - 180;
}

/**
 * The point the sun is directly above.
 *
 * The longitude is the clock: the sun is over the antimeridian at midnight UTC
 * and moves fifteen degrees west an hour. The equation of time is ignored,
 * which moves this by up to four degrees across a year - about fifteen minutes
 * of rotation, and less than the width of the twilight band it is drawn with.
 */
export function sunPosition(date: IsoDate, utcMinutesIntoDay: number): SunPosition {
  const declination = sunLatitude(date);

  return {
    declination:
      Math.abs(declination) < MINIMUM_DECLINATION
        ? Math.sign(declination || 1) * MINIMUM_DECLINATION
        : declination,
    longitude: wrap(180 - (utcMinutesIntoDay / DAY_MINUTES) * 360),
  };
}

/**
 * The sine of the sun's elevation at a point.
 *
 * Positive is day, negative is night, and zero is the terminator itself. The
 * same expression is rebuilt in the globe's style so each city light can work
 * out its own brightness on the GPU.
 */
export function solarElevationSine(latitude: number, longitude: number, sun: SunPosition): number {
  const hourAngle = (longitude - sun.longitude) * DEGREES;

  return (
    Math.sin(latitude * DEGREES) * Math.sin(sun.declination * DEGREES) +
    Math.cos(latitude * DEGREES) * Math.cos(sun.declination * DEGREES) * Math.cos(hourAngle)
  );
}

/**
 * The latitude at which the sun sets, for one longitude.
 *
 * From `sin(lat)sin(dec) + cos(lat)cos(dec)cos(H) = 0`, which rearranges to
 * `tan(lat) = -cos(H) / tan(dec)`. The declination is never zero here, which
 * is what `MINIMUM_DECLINATION` is for.
 */
export function terminatorLatitude(longitude: number, sun: SunPosition): number {
  const hourAngle = (longitude - sun.longitude) * DEGREES;

  return Math.atan(-Math.cos(hourAngle) / Math.tan(sun.declination * DEGREES)) / DEGREES;
}

/** Longitudes the terminator is sampled at. One degree is smooth at any zoom. */
const STEP = 1;

function terminatorPoints(sun: SunPosition): [number, number][] {
  const points: [number, number][] = [];

  for (let longitude = -180; longitude <= 180; longitude += STEP) {
    points.push([longitude, terminatorLatitude(longitude, sun)]);
  }

  return points;
}

/**
 * Which pole is in darkness.
 *
 * The one in the hemisphere the sun is not over: in the northern summer the
 * south pole has polar night, and the dark cap is closed along that edge.
 */
function darkPole(sun: SunPosition): number {
  return sun.declination > 0 ? -90 : 90;
}

/** The dark cap for one sun position: along the terminator, round the pole, closed. */
function nightRing(sun: SunPosition): [number, number][] {
  const curve = terminatorPoints(sun);
  const pole = darkPole(sun);

  // A cap around one pole, which is what the dark half of a tilted planet
  // always is.
  return [...curve, [180, pole], [-180, pole], curve[0]!];
}

/**
 * How many caps the night is drawn as.
 *
 * One polygon cannot have a soft edge, and the edge is the whole problem: a
 * fill steps from nothing to night across a single pixel, and that step is a
 * line drawn across the planet. Nothing about a blur fixes it either, because
 * a blurred line is symmetric about the boundary and the step is still under
 * it.
 *
 * So the night is drawn several times over, each one the cap as it stands a
 * few minutes earlier or later, and each at a fraction of the final darkness.
 * Where every cap overlaps it is fully night; towards either edge fewer and
 * fewer of them reach, and the darkness falls off in steps too fine to find.
 *
 * This is not a trick played on the geometry - it is what dusk is. The places
 * covered by some caps and not others are precisely the places the terminator
 * is about to sweep over, which is the definition of the hour before dark.
 */
export const DUSK_STEPS = 14;

/**
 * How far apart the caps are, in degrees of rotation.
 *
 * Fourteen steps of this is about twenty-two degrees, and the Earth turns
 * twenty-two degrees in ninety minutes - close to how long dusk actually
 * lasts at the latitudes most of the world lives at.
 *
 * Eight steps of two and a half degrees covered the same ground but could be
 * counted: the eye finds a ten per cent jump in darkness across a hard edge
 * without any trouble. Fourteen puts each step at about a tenth of that.
 */
const DUSK_STEP_DEGREES = 1.6;

/** The darkness one cap contributes, so that all of them together reach `NIGHT_ALPHA`. */
export const DUSK_STEP_ALPHA = 1 - Math.pow(1 - 0.84, 1 / DUSK_STEPS);

/**
 * The night, and the line where it starts, as one collection.
 *
 * The caps come first and carry `depth`, which is which of the swept
 * positions each one is; the terminator line is last. Look features up by
 * their `kind`, not by their index.
 */
export function sunGeoJson(sun: SunPosition) {
  const features = [];

  for (let depth = 0; depth < DUSK_STEPS; depth += 1) {
    // Centred on the true terminator, so the ramp is symmetric: the same
    // number of caps fall short at dusk as reach past it at dawn.
    const offset = (depth - (DUSK_STEPS - 1) / 2) * DUSK_STEP_DEGREES;

    features.push({
      type: 'Feature' as const,
      properties: { kind: 'night', depth },
      geometry: {
        type: 'Polygon' as const,
        coordinates: [nightRing({ ...sun, longitude: sun.longitude + offset })],
      },
    });
  }

  features.push({
    type: 'Feature' as const,
    properties: { kind: 'terminator', depth: -1 },
    geometry: { type: 'LineString' as const, coordinates: terminatorPoints(sun) },
  });

  return { type: 'FeatureCollection' as const, features };
}

/**
 * The three numbers the style needs to light the cities itself.
 *
 * Precomputed here because a paint expression can multiply and take a cosine
 * but should not be asked to do the same trigonometry on a constant for every
 * one of seven hundred points on every frame.
 */
export function solarFactors(sun: SunPosition): {
  sinDeclination: number;
  cosDeclination: number;
  longitude: number;
} {
  return {
    sinDeclination: Math.sin(sun.declination * DEGREES),
    cosDeclination: Math.cos(sun.declination * DEGREES),
    longitude: sun.longitude,
  };
}
