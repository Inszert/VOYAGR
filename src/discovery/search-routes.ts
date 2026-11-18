import { resolveDestinationGeo, resolveOriginGeo } from '@/search/destination-names';
import { greatCirclePath } from './geo';
import { LAUNCH_SET } from './launch-set';
import type { Route } from './map-model';

/**
 * The lines a search draws between the places it was asked about.
 *
 * A route in `buildRoutes` exists because a trip was priced. These exist
 * because somebody typed both ends: where from and where to are connected as
 * soon as both are known, before any price. Every origin is joined to every
 * destination, up to a ceiling, and the same pairs are available as text so
 * the line is never the only way to learn that it is there.
 *
 * Nothing here is a price or a distance. An airport with no coordinates gives
 * no line, and is counted so the text can say so.
 */

/** The most lines drawn for one search. */
export const MAX_ROUTE_LINES = 25;

type LngLat = readonly [number, number];

export interface RoutePair {
  readonly origin: string;
  readonly destination: string;
  readonly from: LngLat;
  readonly to: LngLat;
}

export interface RoutePairs {
  /** The pairs that can be drawn, at most `MAX_ROUTE_LINES`. */
  readonly pairs: readonly RoutePair[];
  /** Every pair that was asked for, drawn or not. */
  readonly requested: number;
  /** Pairs left out because an airport has no known position. */
  readonly unplaced: number;
  /** Pairs left out because of the ceiling. */
  readonly beyondCeiling: number;
}

export type PositionOf = (code: string) => LngLat | null;

/** Where an airport is, from the reference data; null when nothing places it. */
export function airportPosition(code: string): LngLat | null {
  return resolveOriginGeo(code)?.position ?? resolveDestinationGeo(code)?.position ?? null;
}

function unique(codes: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const code of codes) {
    const clean = code.trim().toUpperCase();
    if (/^[A-Z]{3}$/.test(clean)) seen.add(clean);
  }
  return [...seen];
}

export function buildRoutePairs(
  origins: readonly string[],
  destinations: readonly string[],
  positionOf: PositionOf = airportPosition,
): RoutePairs {
  const from = unique(origins);
  const to = unique(destinations);
  const pairs: RoutePair[] = [];
  let requested = 0;
  let unplaced = 0;
  let beyondCeiling = 0;

  for (const origin of from) {
    for (const destination of to) {
      if (origin === destination) continue;
      requested += 1;

      let start: LngLat | null = null;
      let end: LngLat | null = null;
      try {
        start = positionOf(origin);
        end = positionOf(destination);
      } catch {
        // A lookup that throws is an airport nothing can place.
      }
      if (!start || !end) {
        unplaced += 1;
        continue;
      }
      if (pairs.length >= MAX_ROUTE_LINES) {
        beyondCeiling += 1;
        continue;
      }
      pairs.push({ origin, destination, from: start, to: end });
    }
  }

  return { pairs, requested, unplaced, beyondCeiling };
}

/** The pairs as routes the globe already knows how to draw. */
export function routePairsToRoutes(pairs: readonly RoutePair[]): Route[] {
  return pairs.map((pair, rank) => ({
    origin: pair.origin,
    destination: pair.destination,
    rank,
    stops: null,
    path: greatCirclePath(pair.from, pair.to),
  }));
}

/** The line as words: "LHR to JFK". */
export function routeText(pair: Pick<RoutePair, 'origin' | 'destination'>): string {
  return `${pair.origin} to ${pair.destination}`;
}

/** How many routes are shown, in words. */
export function routeCountText(result: RoutePairs): string {
  const shown = result.pairs.length;
  const noun = shown === 1 ? 'route' : 'routes';
  const more = result.beyondCeiling > 0 ? `, ${result.beyondCeiling} more not drawn` : '';
  return `${shown} ${noun} shown${more}`;
}

/** Where the default lines start when nobody has typed an origin. */
export const DEFAULT_ROUTE_ORIGIN = 'VIE';
/** How many default lines are drawn from it. */
export const DEFAULT_ROUTE_COUNT = 8;

/**
 * The places to join before anybody has searched.
 *
 * An empty globe says nothing, so with no search the page draws routes from
 * Vienna (or the origin typed) to launch-set airports that have coordinates.
 * They are routes only: no price is attached or implied. A typed destination
 * list is used as typed.
 */
export function defaultRoutePlaces(
  typedOrigins: readonly string[],
  typedDestinations: readonly string[],
  positionOf: PositionOf = airportPosition,
): { origins: string[]; destinations: string[] } {
  const origins = typedOrigins.length > 0 ? [...typedOrigins] : [DEFAULT_ROUTE_ORIGIN];
  if (typedDestinations.length > 0) return { origins, destinations: [...typedDestinations] };

  const destinations: string[] = [];
  for (const code of LAUNCH_SET) {
    if (destinations.length >= DEFAULT_ROUTE_COUNT) break;
    if (origins.includes(code)) continue;
    let placed = null;
    try {
      placed = positionOf(code);
    } catch {
      // Not placeable: skipped.
    }
    if (placed) destinations.push(code);
  }
  return { origins, destinations };
}
