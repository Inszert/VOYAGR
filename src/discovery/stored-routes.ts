import type { RouteGraphRepository } from '@/db/repository';
import { greatCirclePath } from './geo';
import { routesToGeoJson } from './map-model';
import { airportPosition, type PositionOf } from './search-routes';

/**
 * The routes the globe may draw from one origin: those already stored.
 *
 * **This is the whole of the globe's data path while it moves, and it takes a repository and
 * nothing else.** There is no provider and no MCP client in its signature, so a pan, a spin or a
 * zoom cannot become a vendor call. A route exists here because an earlier lookup stored it
 * (`route_graph`); an airport nothing stored is simply not drawn, and one with no known position
 * cannot be.
 */

export interface Bounds {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}

export interface StoredRoute {
  readonly origin: string;
  readonly destination: string;
  readonly from: readonly [number, number];
  readonly to: readonly [number, number];
  /** Carriers seen on this route, sorted. */
  readonly carriers: readonly string[];
  /** The newest time any carrier on the route was seen. */
  readonly lastSeenAt: string;
}

/** The whole planet. */
export const WORLD: Bounds = { west: -180, south: -90, east: 180, north: 90 };

/** A box whose west edge is east of its east edge crosses the antimeridian. */
export function inBounds(point: readonly [number, number], bounds: Bounds): boolean {
  const [lng, lat] = point;
  if (lat < bounds.south || lat > bounds.north) return false;
  return bounds.west <= bounds.east
    ? lng >= bounds.west && lng <= bounds.east
    : lng >= bounds.west || lng <= bounds.east;
}

export async function loadStoredRoutes(input: {
  readonly origin: string;
  readonly bounds: Bounds;
  readonly graph: RouteGraphRepository;
  readonly positionOf?: PositionOf;
}): Promise<StoredRoute[]> {
  const origin = input.origin.toUpperCase();
  const positionOf = input.positionOf ?? airportPosition;
  const from = positionOf(origin);
  if (!from) return [];

  const edges = await input.graph.destinationsFor(origin);
  const byDestination = new Map<string, { carriers: Set<string>; lastSeenAt: string }>();
  for (const edge of edges) {
    const entry = byDestination.get(edge.destination) ?? {
      carriers: new Set<string>(),
      lastSeenAt: edge.lastSeenAt,
    };
    entry.carriers.add(edge.carrier);
    if (edge.lastSeenAt > entry.lastSeenAt) entry.lastSeenAt = edge.lastSeenAt;
    byDestination.set(edge.destination, entry);
  }

  const routes: StoredRoute[] = [];
  for (const [destination, entry] of byDestination) {
    const to = positionOf(destination);
    if (!to || !inBounds(to, input.bounds)) continue;
    routes.push({
      origin,
      destination,
      from,
      to,
      carriers: [...entry.carriers].sort(),
      lastSeenAt: entry.lastSeenAt,
    });
  }
  return routes.sort((a, b) => a.destination.localeCompare(b.destination));
}

/** The most stored lines added to a page's own routes. */
export const MAX_STORED_LINES = 25;

type RouteCollection = ReturnType<typeof routesToGeoJson>;

/**
 * The page's routes plus the stored ones it does not already draw. A stored route has no rank
 * and no stop count (nothing was priced for it), so it sorts after every ranked one and says
 * `stops: null`, which the globe already treats as "not known".
 */
export function withStoredRoutes(
  base: RouteCollection,
  stored: readonly StoredRoute[],
  selected: string | null = null,
): RouteCollection {
  const drawn = new Set(
    base.features.map((f) => `${f.properties.origin}>${f.properties.destination}`),
  );
  const extra = stored
    .filter((route) => !drawn.has(`${route.origin}>${route.destination}`))
    .slice(0, MAX_STORED_LINES);
  if (extra.length === 0) return base;

  const rankFrom = base.features.length;
  const added = routesToGeoJson(
    extra.map((route, i) => ({
      origin: route.origin,
      destination: route.destination,
      rank: rankFrom + i,
      stops: null,
      path: greatCirclePath(route.from, route.to),
    })),
    selected,
  );
  return { ...base, features: [...base.features, ...added.features] };
}
