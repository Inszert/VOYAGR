import type { IsoDate } from '@/core/trip/types';

/**
 * What the world looks like on a given date.
 *
 * The globe should not look the same in May as in December: the Arctic
 * freezes and thaws, the north goes green and then brown, and the sun moves
 * between the tropics. This module works that out.
 *
 * **It is a model of sunlight, not a report about places.** Everything here
 * is derived from one number - the sun's declination on the date - plus the
 * latitude of the band being drawn. No country is coloured from a claim about
 * that country, which is what specification section 16 warns against: "do not
 * falsely colour entire countries if conditions vary significantly by
 * region". A band is a band of latitude, and the interface says so.
 *
 * What that buys, and what it does not. It gets the big pattern right, the
 * one a school atlas gets right: ice at the poles and more of it in winter,
 * a green temperate north in summer, a dry belt under the subtropical highs,
 * green through the tropics. It is wrong about any particular place - Florida
 * is not a desert and Ireland is not Kazakhstan - and it is not a forecast.
 * Nothing in the product reads it: no price, no ranking and no eligibility
 * depends on a single value here. It decides a colour.
 *
 * Pure and deterministic: a date in, the same bands out, every time.
 */

/** What a band of latitude broadly looks like on the date. */
export type SurfaceKind = 'ice' | 'snow' | 'tundra' | 'temperate' | 'arid' | 'tropical';

/**
 * Which broad belt of the Earth a latitude is in.
 *
 * Fixed geography, not season: the dry belt sits under the subtropical highs
 * every month of the year, and the boreal forest is where it is in July as
 * well as January. `kind` above is about sunlight on a date and moves; this
 * does not. The globe uses it to decide what colour the ground is, because
 * land is not one colour and the difference is mostly latitude.
 */
export type LatitudeBelt = 'polar' | 'desert' | 'boreal' | 'temperate';

/**
 * The belt a latitude falls in. Bounds are the usual textbook ones.
 *
 * These have to stay in step with `BELTS` in `scripts/build-geo.mjs`, which
 * is what actually cuts the land up. A test asserts they agree.
 */
export function beltFor(latitude: number): LatitudeBelt {
  const absolute = Math.abs(latitude);

  if (absolute >= 66) return 'polar';
  if (absolute >= 50) return 'boreal';
  if (absolute >= 15 && absolute <= 35) return 'desert';

  return 'temperate';
}

export interface LatitudeBand {
  /** Southern edge, degrees. */
  readonly south: number;
  /** Northern edge, degrees. */
  readonly north: number;
  readonly kind: SurfaceKind;
  /** The belt this band sits in, which does not change with the date. */
  readonly belt: LatitudeBelt;
  /**
   * How strongly the tint applies, 0 to 1.
   *
   * Lets a band fade in rather than switch: the snow line does not arrive
   * everywhere on one day, and a map that pretends it does looks like a bug.
   */
  readonly strength: number;
  /** Hours of daylight at the band's midpoint. 0 or 24 inside a polar night or day. */
  readonly daylightHours: number;
}

export interface SeasonModel {
  readonly date: IsoDate;
  /** The latitude the sun is overhead at noon, degrees. */
  readonly sunLatitude: number;
  /** Bands from south to north. */
  readonly bands: readonly LatitudeBand[];
  /** The month, 1-12, for anything that wants to name it. */
  readonly month: number;
}

const DEGREES = Math.PI / 180;

/** Days before the first of each month in a non-leap year. */
const MONTH_OFFSETS = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];

/**
 * How tall each band is.
 *
 * Two degrees, which is finer than the model deserves but not finer than the
 * eye deserves: at five the steps between bands read as concentric rings
 * drawn on the planet rather than as a polar cap fading out.
 */
/*
 * One degree.
 *
 * The bands carry a `strength` that ramps across the edge of the ice and the
 * snow, and the ramp is only about thirteen degrees wide - so at two degrees
 * a band there were six steps in it, and six steps seen almost edge-on
 * across the top of a sphere read as a stack of plates rather than as ice.
 * Halving the band halves the jump between neighbours; the cost is a hundred
 * and eighty quads instead of ninety, which is nothing.
 */
const BAND_DEGREES = 1;

/**
 * Day of the year, 1 to 366.
 *
 * Read off the ISO string rather than through `Date`: a calendar date is a
 * date, and parsing one into a `Date` for arithmetic is what `src/core/dates`
 * exists to avoid.
 */
export function dayOfYear(date: IsoDate): number {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));

  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const extra = leap && month > 2 ? 1 : 0;

  return (MONTH_OFFSETS[month - 1] ?? 0) + day + extra;
}

/**
 * The latitude the sun stands over at noon, in degrees.
 *
 * The standard approximation: the sun tracks between the tropics on a
 * sinusoid through the year, at the solstice on about 21 December. Accurate
 * to well under a degree, which is finer than any band this draws.
 */
export function sunLatitude(date: IsoDate): number {
  const n = dayOfYear(date);
  return -23.44 * Math.cos(DEGREES * ((360 / 365) * (n + 10)));
}

/**
 * Hours of daylight at a latitude, given where the sun is.
 *
 * The hour angle of sunrise, doubled. `cos(H) = -tan(latitude)·tan(sun)`, so
 * when that falls outside the cosine's domain the arithmetic is telling us
 * there is no sunrise to find: below -1 the sun never sets, above 1 it never
 * rises. Getting those two the wrong way round lights the Arctic in December.
 */
export function daylightHours(latitude: number, sun: number): number {
  const ratio = -Math.tan(latitude * DEGREES) * Math.tan(sun * DEGREES);

  if (ratio <= -1) return 24;
  if (ratio >= 1) return 0;

  return (2 * Math.acos(ratio)) / DEGREES / 15;
}

/** 0 at the winter solstice for this hemisphere, 1 at the summer one. */
function summerness(latitude: number, sun: number): number {
  // The sun is 23.44 degrees north at the northern solstice and the same
  // south at the southern one, so its position scaled into 0..1 and flipped
  // for the southern hemisphere is exactly how far into summer a latitude is.
  const towards = latitude >= 0 ? sun : -sun;
  return Math.min(1, Math.max(0, (towards + 23.44) / 46.88));
}

/** Smooth 0..1 ramp between two thresholds, for edges that fade. */
function ramp(value: number, from: number, to: number): number {
  if (from === to) return value >= to ? 1 : 0;
  return Math.min(1, Math.max(0, (value - from) / (to - from)));
}

/**
 * What a latitude looks like on a date.
 *
 * The rules, in the order they are applied, and why each one is defensible as
 * a statement about sunlight rather than about a country:
 *
 *  - **Ice** where the sea freezes. Its edge moves with the season, further
 *    towards the equator in winter than in summer, which is the single most
 *    visible seasonal change on a globe.
 *  - **Snow** where midwinter days are short and the sun stays low. The line
 *    moves with the season and disappears entirely in summer.
 *  - **Tundra** between the two: the high latitudes that thaw but do not
 *    green.
 *  - **Arid** under the subtropical highs, about 15 to 33 degrees, where the
 *    world's deserts are and where they are in every month.
 *  - **Tropical** near the equator, green the year round.
 *  - **Temperate** everywhere else, greener the longer the day.
 */
export function bandFor(latitude: number, sun: number): { kind: SurfaceKind; strength: number } {
  const absolute = Math.abs(latitude);
  const summer = summerness(latitude, sun);
  const daylight = daylightHours(latitude, sun);

  // Ice: from about 78 degrees at the height of summer down to about 64 in
  // deep winter. Sea ice does roughly this, and it is what makes December
  // and June look like different planets from a distance.
  const iceEdge = 64 + 8 * summer;
  if (absolute >= iceEdge) {
    // Fading in from below its own edge, so the cap has a soft margin rather
    // than a rim. A hard line at a latitude looks like a rendering artefact,
    // which is exactly what it would be.
    return { kind: 'ice', strength: 0.95 * ramp(absolute, iceEdge - 8, iceEdge + 5) };
  }

  // Snow: short days and a low sun. Nothing in summer at any latitude.
  const snowEdge = 42 + 46 * summer;
  if (absolute >= snowEdge && daylight < 11) {
    return { kind: 'snow', strength: 0.8 * ramp(absolute, snowEdge, snowEdge + 16) };
  }

  if (absolute >= 60) return { kind: 'tundra', strength: 0.22 };

  // The dry belt. Present in every month, because the subtropical highs are.
  if (absolute >= 15 && absolute <= 33) {
    const edge = Math.min(ramp(absolute, 15, 19), ramp(33, absolute, 29));
    return { kind: 'arid', strength: 0.45 + 0.35 * edge };
  }

  if (absolute < 15) return { kind: 'tropical', strength: 0.6 };

  // Temperate: green in proportion to the length of the day, which is the
  // thing that actually drives a growing season.
  return { kind: 'temperate', strength: 0.25 + 0.5 * ramp(daylight, 9, 15) };
}

/**
 * The whole world on a date, as bands from south to north.
 *
 * Adjacent bands of the same kind are kept separate rather than merged, so a
 * renderer can fade one into the next instead of drawing a hard edge where
 * two strengths meet.
 */
export function seasonModel(date: IsoDate): SeasonModel {
  const sun = sunLatitude(date);
  const bands: LatitudeBand[] = [];

  for (let south = -90; south < 90; south += BAND_DEGREES) {
    const north = south + BAND_DEGREES;
    const middle = south + BAND_DEGREES / 2;
    const { kind, strength } = bandFor(middle, sun);

    bands.push({
      south,
      north,
      kind,
      belt: beltFor(middle),
      strength,
      daylightHours: Math.round(daylightHours(middle, sun) * 10) / 10,
    });
  }

  return {
    date,
    sunLatitude: Math.round(sun * 100) / 100,
    bands,
    month: Number(date.slice(5, 7)),
  };
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function monthName(month: number): string {
  return MONTH_NAMES[month - 1] ?? '';
}

/**
 * The season in a sentence, for the legend beside the globe.
 *
 * Says what the layer is - a model from the sun's position - rather than
 * letting a reader take a green continent for an observation.
 */
export function describeSeason(model: SeasonModel): string {
  const hemisphere = model.sunLatitude >= 0 ? 'northern' : 'southern';
  const distance = Math.abs(model.sunLatitude);

  const strength =
    distance < 4 ? 'over the equator' : `${distance.toFixed(0)}° into the ${hemisphere} tropics`;

  return `In ${monthName(model.month)} the midday sun stands ${strength}, so the ${hemisphere} hemisphere has the long days and the other has the ice.`;
}

/**
 * The bands as GeoJSON the globe can paint.
 *
 * A band is a ring around the planet, so it is written as a rectangle in
 * longitude and latitude with enough points along its edges to bend with the
 * projection rather than cutting a chord across it.
 */
export function bandsToGeoJson(model: SeasonModel) {
  const step = 10;

  return {
    type: 'FeatureCollection' as const,
    features: model.bands.map((band) => {
      const top: [number, number][] = [];
      const bottom: [number, number][] = [];

      for (let longitude = -180; longitude <= 180; longitude += step) {
        top.push([longitude, band.north]);
        bottom.push([longitude, band.south]);
      }

      return {
        type: 'Feature' as const,
        geometry: {
          type: 'Polygon' as const,
          coordinates: [[...bottom, ...top.reverse(), [-180, band.south]]],
        },
        properties: {
          kind: band.kind,
          belt: band.belt,
          strength: band.strength,
          daylightHours: band.daylightHours,
        },
      };
    }),
  };
}
