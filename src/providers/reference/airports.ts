import airportIndex from './airports.generated.json';

/**
 * Real airport reference data: who exists, where it is, nothing else.
 *
 * Built by `scripts/build-airports.mjs` from OurAirports (public domain,
 * ODC-PDDL), kept to the ~4,100 airports with scheduled commercial service
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

export interface AirportReference {
  readonly code: string;
  readonly name: string;
  readonly municipality: string | null;
  readonly country: string | null;
  readonly type: string;
  /** `[longitude, latitude]`, GeoJSON order. */
  readonly position: readonly [number, number];
}

interface GeneratedEntry {
  readonly name: string;
  readonly municipality: string | null;
  readonly country: string | null;
  readonly type: string;
  readonly position: readonly [number, number];
}

// The generated JSON's `position` is inferred as `number[]`, not a fixed
// tuple, so this is a real widen-then-narrow, not a sign the cast is wrong.
const INDEX = airportIndex as unknown as Record<string, GeneratedEntry>;

/** `null` when the code is not in the dataset - never a guessed position. */
export function resolveAirport(code: string): AirportReference | null {
  const entry = INDEX[code.toUpperCase()];
  return entry ? { code: code.toUpperCase(), ...entry } : null;
}

/** How many airports this build of the reference data actually covers. */
export function airportReferenceCount(): number {
  return Object.keys(INDEX).length;
}
