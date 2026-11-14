import { distanceKm } from '@/discovery/geo';
import { findDestination, DESTINATION_FIXTURES } from '@/providers/fixtures/destinations';
import { AIRPORT_FIXTURES, findAirport } from '@/providers/fixtures/airports';
import { allAirports, resolveAirport } from '@/providers/reference/airports';
import type { AirportCode } from '@/core/trip/types';
import type { DestinationGeo, OriginPoint } from '@/discovery/map-model';
import { findCountryByIso2 } from '@/discovery/countries';

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
    if (fixture) {
      names[code] = fixture.name;
      continue;
    }

    // A real airport the hand-written catalogue does not list: its own city.
    const reference = resolveAirport(code);
    if (reference) names[code] = POPULAR_AIRPORTS[code.toUpperCase()] ?? cityOf(reference);
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
  if (!fixture) return referenceDestinationGeo(destination);

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

/** "Paris (Roissy-en-France, Val-d'Oise)" is a municipality field, not a name. */
function cityOf(airport: { name: string; municipality: string | null }): string {
  return (airport.municipality ?? airport.name).replace(/\s*\(.*\)\s*$/, '').trim();
}

/**
 * A destination placed from the real airport reference data.
 *
 * For an airport the hand-written fixtures do not list. Its position is the
 * airport's own, its name the city it serves, and its country the one the data
 * names; nothing is guessed, and an airport the data does not hold stays
 * unplaced and off the map.
 */
function referenceDestinationGeo(destination: AirportCode): DestinationGeo | null {
  const reference = resolveAirport(destination);
  if (!reference) return null;

  const country = reference.country ? findCountryByIso2(reference.country) : null;

  return {
    name: POPULAR_AIRPORTS[destination.toUpperCase()] ?? cityOf(reference),
    country: country?.name ?? reference.country ?? 'Unknown',
    adm0: country?.adm0 ?? null,
    position: reference.position,
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
  if (destination) {
    return {
      code: origin.toUpperCase(),
      name: destination.name,
      adm0: destination.adm0,
      position: destination.position,
    };
  }

  /*
   * Falls back to the real OurAirports reference data last, after both
   * fixture sources, so every origin already covered by a fixture keeps
   * producing the exact same result it always did - nothing here can
   * change a distance that was already tested. This only widens coverage
   * to a departure airport the small hand-picked fixture set never had.
   */
  const reference = resolveAirport(origin);
  if (!reference) return null;

  return {
    code: reference.code,
    name: reference.municipality ?? reference.name,
    adm0: reference.country,
    position: reference.position,
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
  const fixtures = DESTINATION_FIXTURES.filter(
    (fixture) => fixture.position[0] !== 0 || fixture.position[1] !== 0,
  ).map((fixture) => fixture.airport);

  const known = new Set(fixtures);

  // Only codes the real airport data actually holds: an entry it lacks is
  // dropped rather than placed somewhere plausible.
  const curated = Object.keys(POPULAR_AIRPORTS).filter(
    (code) => !known.has(code) && resolveAirport(code) !== null,
  );
  for (const code of curated) known.add(code);

  return [...fixtures, ...curated, ...countryHubsNotCovered(known)];
}

let hubs: readonly AirportCode[] | undefined;

/**
 * One airport for every country the lists above do not reach, so a trip can be
 * priced to anywhere the vendor flies and not only to the places somebody
 * thought of.
 *
 * Chosen from the real airport data, never typed in: of a country's large
 * airports the one with "International" in its name, then the lowest code, so
 * the pick is the same on every run. Which airport is busiest is not in the
 * data, so this is a stable choice, not a ranking; the curated list names the
 * busy ones for the big countries. A country with no large airport is left out
 * rather than represented by a small one.
 */
function countryHubsNotCovered(covered: ReadonlySet<AirportCode>): readonly AirportCode[] {
  hubs ??= (() => {
    const coveredCountries = new Set(
      [...covered].map((code) => resolveAirport(code)?.country).filter(Boolean),
    );
    const best = new Map<string, { code: string; international: boolean }>();

    for (const airport of allAirports()) {
      if (airport.type !== 'large_airport' || !airport.country) continue;
      if (coveredCountries.has(airport.country)) continue;
      if (!findCountryByIso2(airport.country)) continue;

      const candidate = { code: airport.code, international: /international/i.test(airport.name) };
      const current = best.get(airport.country);

      if (
        !current ||
        (candidate.international && !current.international) ||
        (candidate.international === current.international && candidate.code < current.code)
      ) {
        best.set(airport.country, candidate);
      }
    }

    return [...best.values()].map((entry) => entry.code).sort();
  })();

  return hubs;
}

/**
 * Large airports worth putting on the globe beyond the hand-written fixtures.
 *
 * Code to the city people call it. Where each airport is and which country it
 * is in come from the airport reference data, never from here, so no position
 * is typed in by hand. The city name is set here because the reference's
 * municipality field is not always the city (Krakow's is "Balice"). A metro
 * code (LON, PAR) is not an airport and is absent on purpose.
 */
const POPULAR_AIRPORTS: Readonly<Record<string, string>> = {
  FRA: 'Frankfurt',
  LHR: 'London',
  CDG: 'Paris',
  AMS: 'Amsterdam',
  MAD: 'Madrid',
  BCN: 'Barcelona',
  FCO: 'Rome',
  ATH: 'Athens',
  IST: 'Istanbul',
  PRG: 'Prague',
  BUD: 'Budapest',
  WAW: 'Warsaw',
  CPH: 'Copenhagen',
  DUB: 'Dublin',
  ZRH: 'Zurich',
  MUC: 'Munich',
  BER: 'Berlin',
  MXP: 'Milan',
  VCE: 'Venice',
  NAP: 'Naples',
  MLA: 'Malta',
  OPO: 'Porto',
  AGP: 'Malaga',
  ALC: 'Alicante',
  TFS: 'Tenerife',
  LPA: 'Gran Canaria',
  DBV: 'Dubrovnik',
  SKG: 'Thessaloniki',
  HER: 'Heraklion, Crete',
  RHO: 'Rhodes',
  CFU: 'Corfu',
  SOF: 'Sofia',
  OTP: 'Bucharest',
  RIX: 'Riga',
  TLL: 'Tallinn',
  VNO: 'Vilnius',
  KRK: 'Krakow',
  EDI: 'Edinburgh',
  MAN: 'Manchester',
  ARN: 'Stockholm',
  OSL: 'Oslo',
  HEL: 'Helsinki',
  BRU: 'Brussels',
  GVA: 'Geneva',
  NCE: 'Nice',
  LYS: 'Lyon',
  CAI: 'Cairo',
  SSH: 'Sharm El Sheikh',
  HRG: 'Hurghada',
  AUH: 'Abu Dhabi',
  DOH: 'Doha',
  TLV: 'Tel Aviv',
  AMM: 'Amman',
  LAX: 'Los Angeles',
  MIA: 'Miami',
  CUN: 'Cancun',
  GRU: 'Sao Paulo',
  MLE: 'Maldives',
  SIN: 'Singapore',
  HKG: 'Hong Kong',
  DEL: 'Delhi',
  BOM: 'Mumbai',
  SYD: 'Sydney',
  MEX: 'Mexico City',
  YYZ: 'Toronto',
  GIG: 'Rio de Janeiro',
  BSB: 'Brasilia',
  EZE: 'Buenos Aires',
  SCL: 'Santiago',
  BOG: 'Bogota',
  LIM: 'Lima',
  PTY: 'Panama City',
  NBO: 'Nairobi',
  JNB: 'Johannesburg',
  CMN: 'Casablanca',
  RAK: 'Marrakech',
  TUN: 'Tunis',
  ADD: 'Addis Ababa',
  ACC: 'Accra',
  LOS: 'Lagos',
  SGN: 'Ho Chi Minh City',
  HAN: 'Hanoi',
  KUL: 'Kuala Lumpur',
  MNL: 'Manila',
  PEK: 'Beijing',
  PVG: 'Shanghai',
  ICN: 'Seoul',
  MEL: 'Melbourne',
  AKL: 'Auckland',
  JED: 'Jeddah',
  RUH: 'Riyadh',
  CMB: 'Colombo',
  KTM: 'Kathmandu',
  DAC: 'Dhaka',
  HAV: 'Havana',
  PUJ: 'Punta Cana',
  SJU: 'San Juan',
  MBJ: 'Montego Bay',
  DEN: 'Denver',
  SEA: 'Seattle',
  ATL: 'Atlanta',
  BOS: 'Boston',
  IAD: 'Washington',
  YVR: 'Vancouver',
  YUL: 'Montreal',
  ORD: 'Chicago',
  SFO: 'San Francisco',
  LPB: 'La Paz',
  VVI: 'Santa Cruz (Bolivia)',
  CBB: 'Cochabamba',
  SRE: 'Sucre',
  UIO: 'Quito',
  ASU: 'Asunción',
  MVD: 'Montevideo',
  GYE: 'Guayaquil',
  CUZ: 'Cusco',
};

/** One airport a person can type, and what to show them while they type it. */
export interface AirportSuggestion {
  readonly code: AirportCode;
  /** The city or place, e.g. "Budapest". */
  readonly name: string;
  readonly country: string;
  /** True when the product can price a trip to it, not merely from it. */
  readonly priceable: boolean;
  /**
   * The airport's own name, e.g. "Tenerife Sur Airport". Two airports in one
   * place share a city name ("Tenerife"), and this is what tells them apart.
   */
  readonly detail?: string;
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

  /*
   * Every airport with scheduled service of any size that the real reference
   * data calls "large", before the hand-picked ones. The fixtures alone were
   * a few dozen airports, so a person typing "Tenerife" or "La Paz" was offered
   * nothing and could not pick an airport at all. Anything the fixtures or the
   * curated names say about a code still wins below.
   */
  for (const airport of allAirports()) {
    if (airport.type !== 'large_airport') continue;

    byCode.set(airport.code, {
      code: airport.code,
      name: POPULAR_AIRPORTS[airport.code] ?? cityOf(airport),
      country:
        (airport.country ? findCountryByIso2(airport.country)?.name : null) ??
        airport.country ??
        '',
      priceable: false,
      detail: airport.name,
    });
  }

  for (const airport of AIRPORT_FIXTURES) {
    byCode.set(airport.code, {
      code: airport.code,
      name: airport.city,
      country: airport.country,
      priceable: false,
      detail: byCode.get(airport.code)?.detail ?? resolveAirport(airport.code)?.name,
    });
  }

  for (const fixture of DESTINATION_FIXTURES) {
    byCode.set(fixture.airport, {
      code: fixture.airport,
      name: fixture.name,
      country: fixture.country,
      priceable: true,
      detail: byCode.get(fixture.airport)?.detail ?? resolveAirport(fixture.airport)?.name,
    });
  }

  return [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code));
}

/** A main airport in a country, placed. */
export interface CountryAirport {
  readonly code: AirportCode;
  readonly name: string;
  /** `[longitude, latitude]`. */
  readonly position: readonly [number, number];
}

/**
 * The main airports in one country, for when it is opened on the globe.
 *
 * Real reference data, `large_airport` only, with the ones the product names
 * itself first - those are the airports somebody has actually heard of - and
 * the rest by code so the list is stable. Capped, because a country of a
 * hundred airports is a globe of a hundred pins. Anything in `exclude` is
 * skipped: the priced ones are already shown, with their prices.
 */
export function listMainAirportsInCountry(
  iso2: string,
  exclude: ReadonlySet<string> = new Set(),
  limit = 10,
): CountryAirport[] {
  const key = iso2.toUpperCase();

  return allAirports()
    .filter(
      (airport) =>
        airport.type === 'large_airport' && airport.country === key && !exclude.has(airport.code),
    )
    .sort((a, b) => {
      const curated = Number(b.code in POPULAR_AIRPORTS) - Number(a.code in POPULAR_AIRPORTS);
      return curated !== 0 ? curated : a.code.localeCompare(b.code);
    })
    .slice(0, limit)
    .map((airport) => ({
      code: airport.code,
      name: POPULAR_AIRPORTS[airport.code] ?? cityOf(airport),
      position: airport.position,
    }));
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

  /*
   * Fixtures first, then the real OurAirports reference data for every code
   * the fixtures do not already cover. A `Map` keyed by code means a fixture
   * entry always wins its own code - nothing already tested against the
   * small hand-picked set can change - while a real-world departure airport
   * the demo catalogue never had now gets suggested too, which is the whole
   * point of wiring this dataset in at all.
   */
  const candidates = new Map<
    string,
    { code: string; name: string; position: readonly [number, number] }
  >();

  for (const airport of AIRPORT_FIXTURES) {
    candidates.set(airport.code, {
      code: airport.code,
      name: airport.city,
      position: airport.position,
    });
  }

  for (const airport of allAirports()) {
    if (!candidates.has(airport.code)) {
      candidates.set(airport.code, {
        code: airport.code,
        name: airport.municipality ?? airport.name,
        position: airport.position,
      });
    }
  }

  return [...candidates.values()]
    .filter((airport) => !searched.includes(airport.code))
    .map((airport) => ({
      code: airport.code,
      name: airport.name,
      km: Math.round(Math.min(...from.map((point) => distanceKm(point, airport.position)))),
    }))
    .filter((airport) => airport.km <= withinKm)
    .sort((a, b) => a.km - b.km);
}
