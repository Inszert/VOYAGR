import { distanceKm } from '@/discovery/geo';
import { findDestination, DESTINATION_FIXTURES } from '@/providers/fixtures/destinations';
import { AIRPORT_FIXTURES, findAirport } from '@/providers/fixtures/airports';
import type { AirportCode } from '@/core/trip/types';
import type { DestinationGeo, OriginPoint } from '@/discovery/map-model';

/**
 * Airport code to place name, for display only.
 *
 * A deliberate stand-in for the `destinations` table (specification section
 * 21), which does not exist yet. It is the one place in the application that
 * reads provider fixture data, and it is confined to this module so that
 * replacing it later is a change to one function rather than a hunt through
 * components.
 *
 * Display only. No cost, constraint or score reads anything from here, and an
 * unknown code falls back to itself rather than to an invented name.
 */
export function resolveDestinationNames(
  codes: readonly AirportCode[],
): Record<AirportCode, string> {
  const names: Record<AirportCode, string> = {};

  for (const code of codes) {
    const fixture = findDestination(code);
    if (fixture) names[code] = fixture.name;
  }

  return names;
}

/**
 * Where a destination is, for the discovery map.
 *
 * Lives here for the same reason the names do: this module is the only place
 * in the application allowed to read provider fixture data, so replacing the
 * stand-in with the real `destinations` table is a change to one file.
 *
 * Returns null for anything the catalogue does not know, and the map drops it.
 * A marker placed somewhere plausible would be an invented fact, and on a map
 * an invented fact is unusually convincing - a dot on a coastline looks like
 * knowledge.
 */
export function resolveDestinationGeo(destination: AirportCode): DestinationGeo | null {
  const fixture = findDestination(destination);
  if (!fixture) return null;

  const [longitude, latitude] = fixture.position;
  // The fallback profile sits at [0, 0], which is in the Atlantic. Treat it as
  // "unplaced" rather than drawing the Gulf of Guinea.
  if (longitude === 0 && latitude === 0) return null;

  return {
    name: fixture.name,
    country: fixture.country,
    adm0: fixture.adm0,
    position: fixture.position,
    // Everything the product can currently reach is an airport a scheduled
    // airline flies to. Smaller tiers arrive with the places they describe.
    tier: 'major',
  };
}

/**
 * Where a departure airport is, for the other end of a route.
 *
 * Origins and destinations are both airports, so a destination can be flown
 * from too. An origin nothing can place draws no route rather than a route
 * from somewhere plausible.
 */
export function resolveOriginGeo(origin: AirportCode): OriginPoint | null {
  const airport = findAirport(origin);
  if (airport) {
    return {
      code: airport.code,
      name: airport.city,
      adm0: airport.adm0,
      position: airport.position,
    };
  }

  const destination = resolveDestinationGeo(origin);
  if (!destination) return null;

  return {
    code: origin.toUpperCase(),
    name: destination.name,
    adm0: destination.adm0,
    position: destination.position,
  };
}

/**
 * Every destination the catalogue can put on the globe.
 *
 * The discovery snapshot prices all of them, because "where can I go?" is a
 * question about the whole catalogue rather than about whichever three
 * airports the form defaults to.
 */
export function listPlaceableDestinations(): AirportCode[] {
  return DESTINATION_FIXTURES.filter(
    (fixture) => fixture.position[0] !== 0 || fixture.position[1] !== 0,
  ).map((fixture) => fixture.airport);
}

/** One airport a person can type, and what to show them while they type it. */
export interface AirportSuggestion {
  readonly code: AirportCode;
  /** The city or place, e.g. "Budapest". */
  readonly name: string;
  readonly country: string;
  /** True when the product can price a trip to it, not merely from it. */
  readonly priceable: boolean;
}

/**
 * Every airport the catalogue knows, for the search's suggestions.
 *
 * Origins and destinations together, because a person typing "BU" is asking
 * the same question in either field. Sorted by code so the list is stable and
 * a suggestion does not move under the cursor between renders.
 *
 * Confined here like the rest of the catalogue: this module is the only place
 * allowed to read provider fixtures, so the real `destinations` table
 * replaces one function rather than a hunt through components.
 */
export function listAirports(): AirportSuggestion[] {
  const byCode = new Map<string, AirportSuggestion>();

  for (const airport of AIRPORT_FIXTURES) {
    byCode.set(airport.code, {
      code: airport.code,
      name: airport.city,
      country: airport.country,
      priceable: false,
    });
  }

  for (const fixture of DESTINATION_FIXTURES) {
    byCode.set(fixture.airport, {
      code: fixture.airport,
      name: fixture.name,
      country: fixture.country,
      priceable: true,
    });
  }

  return [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
}

/** The catalogue's destinations inside one country, by Natural Earth key. */
export function listDestinationsInCountry(adm0: string): AirportCode[] {
  const key = adm0.toUpperCase();
  return DESTINATION_FIXTURES.filter((fixture) => fixture.adm0 === key).map(
    (fixture) => fixture.airport,
  );
}

/** One departure airport near the ones searched. */
export interface NearbyOrigin {
  readonly code: AirportCode;
  readonly name: string;
  /** Great-circle distance from the nearest searched origin, whole kilometres. */
  readonly km: number;
}

/**
 * Departure airports near the ones already searched, nearest first.
 *
 * Only airports the catalogue can place, measured along the great circle
 * from whichever searched origin is closest - a straight-line distance, not
 * a drive, and said as such where it is shown. Nothing about price is
 * implied: a nearby airport is a suggestion to search, not a cheaper trip.
 */
export function nearbyOrigins(origins: readonly AirportCode[], withinKm = 250): NearbyOrigin[] {
  const searched = origins.map((code) => code.toUpperCase());
  const from = searched.flatMap((code) => {
    const place = resolveOriginGeo(code);
    return place ? [place.position] : [];
  });
  if (from.length === 0) return [];

  return AIRPORT_FIXTURES.filter((airport) => !searched.includes(airport.code))
    .map((airport) => ({
      code: airport.code,
      name: airport.city,
      km: Math.round(Math.min(...from.map((point) => distanceKm(point, airport.position)))),
    }))
    .filter((airport) => airport.km <= withinKm)
    .sort((a, b) => a.km - b.km);
}
