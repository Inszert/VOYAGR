import { format } from '@/core/money';
import type { DataProvenance } from '@/core/trip/provenance';
import { parseCountry, type Country } from '@/discovery/countries';
import {
  buildMapPoints,
  buildRoutes,
  groupByCountry,
  originsToGeoJson,
  routesToGeoJson,
  toGeoJson,
  type DestinationPoint,
  type MapMode,
  type OriginPoint,
} from '@/discovery/map-model';
import type { DiscoveryAssumptions } from '@/discovery/snapshot';
import {
  listDestinationsInCountry,
  resolveDestinationGeo,
  resolveOriginGeo,
} from '@/search/destination-names';
import { describeRegions, hasRegions, regionsUrl } from './regions';
import type { SearchOutcome } from '@/search/types';

/**
 * Everything the stage shows, computed once per request.
 *
 * The homepage and the explorer render the same stage over the same data, so
 * the assembly lives here rather than in either page: points from whichever
 * search is on the page, routes from the origins to them, chips with a label
 * formatted from `Money`, and the country selection applied to all three.
 *
 * Nothing here computes a figure. `format` formats one the engine produced.
 */

/** The versioned country files the browser fetches. Bumped by scripts/build-geo.mjs. */
export const COUNTRIES_URL = '/geo/countries-110m.v2.json';

/** Finer coastlines, fetched by the globe only once it is zoomed in. */
export const COUNTRIES_DETAIL_URL = '/geo/countries-50m.v2.json';

/**
 * The land itself: Natural Earth's dissolved 50m land, no boundaries in it.
 * This is the shape the sphere draws; the country files above are only how a
 * click resolves to a country.
 */
export const LAND_URL = '/geo/land-50m.v2.json';

/** Glaciers and ice shelves, from Natural Earth. The white is where ice is. */
export const ICE_URL = '/geo/ice-50m.v2.json';

/** Capitals and the major airports, both from Natural Earth. */
export const PLACES_URL = '/geo/places.v2.json';

/** Mountain ranges, deserts and plateaus. Real geography, not a texture. */
export const PHYSICAL_URL = '/geo/physical.v2.json';

/**
 * The lights of the night side: forty-two thousand points thresholded out of
 * NASA's Black Marble composite by `scripts/build-city-lights.mjs`, each
 * carrying the brightness of the pixel it came from.
 */
export const CITY_LIGHTS_URL = '/geo/city-lights.v3.json';
/** The shore on its own, for the shallow water drawn along it. */
export const COASTLINE_URL = '/geo/coastline.v2.json';

export interface StageDataInput {
  readonly outcome: SearchOutcome | null;
  readonly mode: MapMode;
  /** The `country` query parameter, raw. */
  readonly country: string | undefined;
  /** The destination the results are narrowed to, if any. */
  readonly selectedDestination: string | null;
  /** Origins to draw routes from. The search's, or the snapshot's. */
  readonly origins: readonly string[];
  readonly provenance: DataProvenance;
  readonly assumptions: DiscoveryAssumptions | null;
  /** Builds the link a chip or card follows for a destination. */
  readonly hrefFor: (destination: string) => string;
  /** What that link does, for the accessible name. */
  readonly actionLabel: string;
  /** Builds the link to a destination's own page. */
  readonly aboutHrefFor: (destination: string) => string;
}

export interface StageData {
  readonly points: readonly DestinationPoint[];
  /** The points inside the selected country, or all of them. */
  readonly visiblePoints: readonly DestinationPoint[];
  readonly originPoints: readonly OriginPoint[];
  readonly country: Country | null;
  readonly countryCounts: Readonly<Record<string, number>>;
  readonly labels: Readonly<Record<string, string>>;
  readonly chips: readonly {
    readonly destination: string;
    readonly name: string;
    readonly country: string;
    readonly adm0: string | null;
    readonly position: readonly [number, number];
    readonly label: string;
    readonly reason: string;
    readonly href: string;
    readonly actionLabel: string;
    readonly rank: number;
    readonly highlighted: boolean;
  }[];
  readonly routes: ReturnType<typeof routesToGeoJson>;
  readonly pointsGeoJson: ReturnType<typeof toGeoJson>;
  readonly originsGeoJson: ReturnType<typeof originsToGeoJson>;
  readonly cards: readonly {
    readonly point: DestinationPoint;
    readonly label: string;
    readonly href: string;
    readonly actionLabel: string;
    readonly aboutHref: string;
  }[];
  /** The airports in the selected country, for the search's destination field. */
  readonly countryDestinations: readonly string[];
  /** Where the globe fetches the selected country's regions, or null. */
  readonly regionsUrl: string | null;
  /** How many regions that country has, in words, or null. */
  readonly regionSummary: string | null;
}

export function buildStageData(input: StageDataInput): StageData {
  const points = input.outcome
    ? buildMapPoints({ outcome: input.outcome, mode: input.mode, geo: resolveDestinationGeo })
    : [];

  const country = parseCountry(input.country);
  const visiblePoints = country ? points.filter((point) => point.adm0 === country.adm0) : points;

  const originPoints = input.origins
    .map((code) => resolveOriginGeo(code))
    .filter((origin): origin is OriginPoint => origin !== null);

  const countryCounts = Object.fromEntries(
    groupByCountry(points).map((group) => [group.adm0, group.points.length]),
  );

  const labels = Object.fromEntries(
    points.map((point) => [
      point.destination,
      point.cheapestTotal ? `from ${format(point.cheapestTotal)}` : 'Nothing priced',
    ]),
  );

  const chips = points.map((point, rank) => ({
    destination: point.destination,
    name: point.name,
    country: point.country,
    adm0: point.adm0,
    position: point.position,
    label: labels[point.destination]!,
    reason: point.reason,
    href: input.hrefFor(point.destination),
    actionLabel: input.actionLabel,
    rank,
    highlighted:
      point.destination === input.selectedDestination ||
      (country !== null && point.adm0 === country.adm0),
  }));

  const cards = visiblePoints.map((point) => ({
    point,
    label: labels[point.destination]!,
    href: input.hrefFor(point.destination),
    actionLabel: input.actionLabel,
    aboutHref: input.aboutHrefFor(point.destination),
  }));

  return {
    points,
    visiblePoints,
    originPoints,
    country,
    countryCounts,
    labels,
    chips,
    routes: routesToGeoJson(buildRoutes(points, originPoints), input.selectedDestination),
    pointsGeoJson: toGeoJson(points, input.mode),
    originsGeoJson: originsToGeoJson(originPoints),
    cards,
    countryDestinations: country ? listDestinationsInCountry(country.adm0) : [],
    regionsUrl: country && hasRegions(country.adm0) ? regionsUrl(country.adm0) : null,
    regionSummary: country ? describeRegions(country.adm0) : null,
  };
}

/**
 * A query string with some keys replaced or removed.
 *
 * Shared by every link on the stage, so a mode chip, a country selection and
 * a destination filter all keep the search they sit on.
 */
export function withQuery(
  values: Readonly<Record<string, string | undefined>>,
  overrides: Readonly<Record<string, string | null>>,
): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(values)) {
    if (typeof value === 'string' && value !== '' && !(key in overrides)) params.set(key, value);
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (value !== null) params.set(key, value);
  }

  return params.toString();
}
