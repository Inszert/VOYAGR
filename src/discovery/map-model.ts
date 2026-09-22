import type { Money } from '@/core/money';
import type { AirportCode } from '@/core/trip/types';
import type { DateWeather } from '@/search/date-options';
import type { SearchOutcome } from '@/search/types';
import { greatCirclePath, type LngLat } from './geo';

/**
 * What the map shows, and why (1.10.1 sections 11-14).
 *
 * Section 28 sets the scope: the globe does not need production intelligence
 * yet, but it must already have the right architecture so it is not bolted on
 * later. This module is that architecture - the part with no pixels in it.
 *
 * Everything on the map is derived here, deterministically, from trips the
 * search already priced. The renderer draws points; it never decides what a
 * point means, what it costs or where it ranks. That split is the whole point:
 * swapping the renderer, or adding five thousand places, changes nothing here.
 *
 * Section 14 is explicit that the optimisation logic must not be hidden, so
 * every point carries a `reason` in words - and the reason quotes a figure the
 * engines produced rather than describing one.
 */

/**
 * Optimisation modes the map can rank by.
 *
 * Section 14 also lists "best season", "most interesting" and "flexible".
 * Those need seasonal intelligence and a place catalogue that do not exist
 * (sections 15 to 22, Phase 2 and 3). A mode that silently ranked by
 * something else would be worse than an absent one, so they are absent.
 */
export type MapMode = 'cheapest' | 'best-value' | 'fastest' | 'fewest-stops' | 'best-weather';

export const MAP_MODES = [
  'cheapest',
  'best-value',
  'fastest',
  'fewest-stops',
  'best-weather',
] as const satisfies readonly MapMode[];

export const MAP_MODE_LABELS: Record<MapMode, string> = {
  cheapest: 'Cheapest',
  'best-value': 'Best value',
  fastest: 'Fastest',
  'fewest-stops': 'Fewest stops',
  'best-weather': 'Best weather',
};

/**
 * How prominent a place is, which decides the zoom it appears at.
 *
 * Section 12 wants major destinations at low zoom and progressively smaller
 * ones as the user zooms in, rather than thousands of markers at once. The
 * tiers exist so that rule lives in the data rather than in the renderer.
 * Everything the product can currently reach is an airport a scheduled airline
 * flies to, so everything is `major` today - the other tiers arrive with the
 * places they describe, not before.
 */
export type PlaceTier = 'major' | 'secondary' | 'local';

/** The zoom each tier becomes visible at. Read by the renderer, set here. */
export const TIER_MIN_ZOOM: Record<PlaceTier, number> = {
  major: 0,
  secondary: 4,
  local: 6,
};

export interface DestinationPoint {
  readonly destination: AirportCode;
  readonly name: string;
  readonly country: string;
  /** Natural Earth key of the country, or null when we cannot say which. */
  readonly adm0: string | null;
  /** `[longitude, latitude]`, GeoJSON order. */
  readonly position: readonly [number, number];
  readonly tier: PlaceTier;
  readonly cheapestTotal: Money | null;
  readonly bestScore: number | null;
  /** Shortest total flying time, both legs, of any trip found here. */
  readonly fastestMinutes: number | null;
  /** Fewest connections on the busier leg of any trip found here. */
  readonly fewestStops: number | null;
  readonly weather: DateWeather | null;
  readonly tripCount: number;
  /** Why this destination appears, in words. Section 14. */
  readonly reason: string;
}

function hoursAndMinutes(minutes: number): string {
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

/**
 * Where a point sits in the chosen mode. Lower sorts first.
 *
 * Returns null when the mode cannot be answered for this destination - no
 * price, no weather. A destination that cannot be ranked is shown last and
 * says why, rather than being scored zero and shown as the worst.
 */
function rankValue(point: Omit<DestinationPoint, 'reason'>, mode: MapMode): number | null {
  switch (mode) {
    case 'cheapest':
      return point.cheapestTotal?.amount ?? null;
    case 'best-value':
      return point.bestScore === null ? null : -point.bestScore;
    case 'fastest':
      return point.fastestMinutes;
    case 'fewest-stops':
      return point.fewestStops;
    case 'best-weather':
      return point.weather ? point.weather.rainChance : null;
  }
}

/**
 * Why this destination appears, in the mode the user chose.
 *
 * Section 14: do not hide the optimisation logic. Every figure quoted here was
 * produced by the cost, scoring or weather side of the pipeline - this
 * function chooses words, never numbers.
 */
function explainPoint(point: Omit<DestinationPoint, 'reason'>, mode: MapMode): string {
  if (point.tripCount === 0) return 'No trip here came in under your limits.';

  switch (mode) {
    case 'cheapest':
      return point.cheapestTotal ? `Cheapest trip found here, all in.` : 'Nothing priced here yet.';
    case 'best-value':
      return point.bestScore === null
        ? 'Nothing scored here yet.'
        : `Scores ${point.bestScore} out of 100 against what you asked for.`;
    case 'fastest':
      return point.fastestMinutes === null
        ? 'No flight time recorded here.'
        : `${hoursAndMinutes(point.fastestMinutes)} in the air, there and back.`;
    case 'fewest-stops':
      return point.fewestStops === null
        ? 'No routing recorded here.'
        : point.fewestStops === 0
          ? 'Direct both ways.'
          : `${point.fewestStops} ${point.fewestStops === 1 ? 'connection' : 'connections'} at worst.`;
    case 'best-weather':
      if (!point.weather) return 'No outlook for these dates.';
      return point.weather.confidence < 0.5
        ? `${Math.round(point.weather.maxC)}°C and a ${Math.round(point.weather.rainChance * 100)}% chance of rain, typical for the season.`
        : `${Math.round(point.weather.maxC)}°C and a ${Math.round(point.weather.rainChance * 100)}% chance of rain.`;
  }
}

/** Position and place names for a destination, or null when we cannot place it. */
export interface DestinationGeo {
  readonly name: string;
  readonly country: string;
  /** Natural Earth `ADM0_A3`, so a place can be put inside a border. */
  readonly adm0: string | null;
  readonly position: readonly [number, number];
  readonly tier: PlaceTier;
}

export interface BuildMapPointsOptions {
  readonly outcome: SearchOutcome;
  readonly mode: MapMode;
  /** Injected, so this module never reaches into provider fixtures itself. */
  readonly geo: (destination: AirportCode) => DestinationGeo | null;
}

/**
 * One point per destination the search found trips for.
 *
 * Built from `destinationSummaries`, which covers every eligible trip, rather
 * than from `results`, which is a page of forty. Answering "where can I go?"
 * from a page would drop the cheap places that lost on score - the ones
 * somebody browsing a map came for.
 *
 * A destination we cannot place is dropped rather than guessed at. Putting a
 * marker somewhere plausible would be an invented fact of exactly the kind the
 * rest of this codebase refuses, and on a map it is a particularly convincing
 * one - a dot on a coastline looks like knowledge.
 *
 * Sorted by the chosen mode, with the unanswerable last. The order is what the
 * accessible list renders in, so it is the answer to "where can I go?" whether
 * or not the map ever draws.
 */
export function buildMapPoints({ outcome, mode, geo }: BuildMapPointsOptions): DestinationPoint[] {
  const points: DestinationPoint[] = [];

  for (const summary of outcome.destinationSummaries) {
    const place = geo(summary.destination);
    if (!place) continue;

    const partial: Omit<DestinationPoint, 'reason'> = {
      destination: summary.destination,
      name: place.name,
      country: place.country,
      adm0: place.adm0,
      position: place.position,
      tier: place.tier,
      cheapestTotal: summary.cheapestTotal,
      bestScore: summary.bestScore,
      fastestMinutes: summary.fastestMinutes,
      fewestStops: summary.fewestStops,
      weather: summary.weather,
      tripCount: summary.tripCount,
    };

    points.push({ ...partial, reason: explainPoint(partial, mode) });
  }

  return points.sort((a, b) => {
    const left = rankValue(a, mode);
    const right = rankValue(b, mode);

    // Unanswerable last, and alphabetical after that, so the list does not
    // reshuffle between renders of the same search.
    if (left === null && right === null) return a.destination.localeCompare(b.destination);
    if (left === null) return 1;
    if (right === null) return -1;
    if (left !== right) return left - right;

    return a.destination.localeCompare(b.destination);
  });
}

/**
 * The points as GeoJSON, for whichever renderer draws them.
 *
 * Properties are flattened to strings and numbers because that is all a map
 * source carries. `totalMinorUnits` stays in minor units with its currency
 * beside it - a map is not somewhere to start doing money arithmetic in
 * floats, and the label is formatted before it ever gets here.
 */
export function toGeoJson(points: readonly DestinationPoint[], mode: MapMode) {
  return {
    type: 'FeatureCollection' as const,
    features: points.map((point, index) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [...point.position] },
      properties: {
        destination: point.destination,
        name: point.name,
        country: point.country,
        adm0: point.adm0,
        reason: point.reason,
        rank: index,
        minzoom: TIER_MIN_ZOOM[point.tier],
        totalMinorUnits: point.cheapestTotal?.amount ?? null,
        currency: point.cheapestTotal?.currency ?? null,
        mode,
      },
    })),
  };
}

/**
 * The mode a query string asks for, defaulting to best value.
 *
 * Best value rather than cheapest, because the product's claim is that the
 * best trip is not usually the cheapest one - and a discovery surface that
 * opens on price teaches the opposite.
 */
export function parseMapMode(raw: string | undefined): MapMode {
  return MAP_MODES.includes(raw as MapMode) ? (raw as MapMode) : 'best-value';
}

/** A departure airport, placed. The other end of every route. */
export interface OriginPoint {
  readonly code: AirportCode;
  readonly name: string;
  readonly adm0: string | null;
  readonly position: LngLat;
}

/**
 * A route the search priced, from an origin to a destination.
 *
 * The path is the great circle, in segments because a route may cross the
 * antimeridian. `rank` is the destination's position in the chosen mode, so
 * the renderer can draw the best route strongest without knowing what "best"
 * meant.
 */
export interface Route {
  readonly origin: AirportCode;
  readonly destination: AirportCode;
  readonly rank: number;
  readonly path: readonly (readonly LngLat[])[];
}

/**
 * One route per origin and priced destination.
 *
 * Only destinations with at least one trip get a route: a line to a place
 * nothing was found for would claim a connection the search did not make.
 */
export function buildRoutes(
  points: readonly DestinationPoint[],
  origins: readonly OriginPoint[],
): Route[] {
  const routes: Route[] = [];

  points.forEach((point, rank) => {
    if (point.tripCount === 0) return;

    for (const origin of origins) {
      routes.push({
        origin: origin.code,
        destination: point.destination,
        rank,
        path: greatCirclePath(origin.position, point.position),
      });
    }
  });

  return routes;
}

/** The routes as GeoJSON, with the selected destination's routes flagged. */
export function routesToGeoJson(routes: readonly Route[], selected: AirportCode | null = null) {
  return {
    type: 'FeatureCollection' as const,
    features: routes.map((route) => ({
      type: 'Feature' as const,
      geometry: {
        type: 'MultiLineString' as const,
        coordinates: route.path.map((segment) => segment.map((point) => [...point])),
      },
      properties: {
        origin: route.origin,
        destination: route.destination,
        rank: route.rank,
        selected: route.destination === selected,
      },
    })),
  };
}

export function originsToGeoJson(origins: readonly OriginPoint[]) {
  return {
    type: 'FeatureCollection' as const,
    features: origins.map((origin) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [...origin.position] },
      properties: { code: origin.code, name: origin.name },
    })),
  };
}

/** The destinations inside one country, in the order the mode ranked them. */
export interface CountryGroup {
  readonly adm0: string;
  readonly country: string;
  readonly points: readonly DestinationPoint[];
}

/**
 * Points grouped by country, first country by best point.
 *
 * A point whose country is unknown is left out of every group rather than put
 * in an "unknown" one: on a globe a country is a shape, and a shape we cannot
 * name is a shape we should not select.
 */
export function groupByCountry(points: readonly DestinationPoint[]): CountryGroup[] {
  const groups = new Map<string, { country: string; points: DestinationPoint[] }>();

  for (const point of points) {
    if (point.adm0 === null) continue;

    const existing = groups.get(point.adm0);
    if (existing) existing.points.push(point);
    else groups.set(point.adm0, { country: point.country, points: [point] });
  }

  return [...groups].map(([adm0, group]) => ({ adm0, ...group }));
}
