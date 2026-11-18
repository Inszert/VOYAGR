import airportList from '../fixtures/airports.generated.json';
import { AIRPORT_FIXTURES } from '../fixtures/airports';

/**
 * Real airport reference data: who exists, where it is, nothing else.
 *
 * Built by `scripts/build-airports.mjs` (`npm run build:airports`) from
 * OurAirports (public domain, ODC-PDDL), kept to the ~4,000 airports with scheduled commercial service
 * and an IATA code. This answers "where is KSC?", never "what does a flight
 * from KSC cost?" - that question belongs to a flight provider, and nothing
 * here carries a price, a schedule, or an opinion about either.
 *
 * Deliberately separate from `src/providers/fixtures/airports.ts` and
 * `fixtures/destinations.ts`, which are hand-picked development data for the
 * mock providers and the globe demo and say so in their own header comments.
 * This file is real for every code it has, and `null` for every code it does
 * not - it is never allowed to invent a position to fill a gap.
 */

export type AirportSize = 'large' | 'medium' | 'small';

export interface AirportReference {
  readonly code: string;
  readonly icao: string | null;
  readonly name: string;
  readonly municipality: string | null;
  /** ISO 3166-1 alpha-2. */
  readonly country: string | null;
  readonly countryName: string | null;
  /** OurAirports' own class: large_airport, medium_airport or small_airport. */
  readonly type: string;
  /** The same class as a size, so a map can mark the big airports differently. */
  readonly size: AirportSize;
  /** `[longitude, latitude]`, GeoJSON order. */
  readonly position: readonly [number, number];
}

interface GeneratedEntry {
  readonly iata: string;
  readonly icao: string | null;
  readonly name: string;
  readonly city: string | null;
  readonly country: string;
  readonly countryName: string | null;
  readonly latitude: number;
  readonly longitude: number;
  readonly type: AirportSize;
}

const INDEX: Record<string, AirportReference> = {};
for (const entry of airportList as readonly GeneratedEntry[]) {
  INDEX[entry.iata] = {
    code: entry.iata,
    icao: entry.icao,
    name: entry.name,
    municipality: entry.city,
    country: entry.country,
    countryName: entry.countryName,
    type: `${entry.type}_airport`,
    size: entry.type,
    position: [entry.longitude, entry.latitude],
  };
}
// Hand-written fixtures win on conflict: their name, city and position are
// kept, and the generated size and country are added. A fixture that is not
// in the generated data stays out of the index (it has no size to state).
for (const fixture of AIRPORT_FIXTURES) {
  const generated = INDEX[fixture.code];
  if (generated) {
    INDEX[fixture.code] = {
      ...generated,
      name: fixture.name,
      municipality: fixture.city,
      position: fixture.position,
    };
  }
}

/** `null` when the code is not in the dataset - never a guessed position. */
export function resolveAirport(code: string): AirportReference | null {
  const entry = INDEX[code.toUpperCase()];
  return entry ?? null;
}

/** How many airports this build of the reference data actually covers. */
export function airportReferenceCount(): number {
  return Object.keys(INDEX).length;
}

/**
 * Every airport this build covers, for callers that need to search across
 * all of them (nearby-airport suggestions) rather than resolve one known
 * code. Computed once and cached - the underlying JSON does not change at
 * runtime.
 */
let all: readonly AirportReference[] | undefined;

export function allAirports(): readonly AirportReference[] {
  all ??= Object.values(INDEX);
  return all;
}
