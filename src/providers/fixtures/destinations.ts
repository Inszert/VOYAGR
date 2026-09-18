/**
 * Destination fixtures for the mock providers.
 *
 * A small, hand-written set covering the Mediterranean and Caucasus examples in
 * the product specification. These exist so the search, cost and scoring
 * pipeline can be developed and tested end to end with no external API access.
 *
 * This is development data, not a product data set. Real destination metadata
 * belongs in the `destinations` table (specification section 21).
 */

export interface DestinationFixture {
  readonly airport: string;
  readonly name: string;
  readonly country: string;
  readonly region: 'mediterranean' | 'caucasus' | 'atlantic' | 'central_europe';
  /** Typical flight time in minutes from Vienna, used to shape mock offers. */
  readonly typicalFlightMinutes: number;
  /** Baseline nightly hotel price in minor units (EUR cents) for a mid-range room. */
  readonly baselineHotelNightlyCents: number;
  /** Baseline return flight price per passenger, in EUR cents. */
  readonly baselineFlightCents: number;
  readonly hasBeach: boolean;
  /** Mean daily maximum in Celsius by month index (0 = January). */
  readonly monthlyHighC: readonly number[];
}

export const DESTINATION_FIXTURES: readonly DestinationFixture[] = [
  {
    airport: 'AYT',
    name: 'Antalya',
    country: 'Turkey',
    region: 'mediterranean',
    typicalFlightMinutes: 165,
    baselineHotelNightlyCents: 5400,
    baselineFlightCents: 14900,
    hasBeach: true,
    monthlyHighC: [15, 16, 19, 23, 27, 33, 36, 36, 32, 27, 21, 16],
  },
  {
    airport: 'CHQ',
    name: 'Chania, Crete',
    country: 'Greece',
    region: 'mediterranean',
    typicalFlightMinutes: 150,
    baselineHotelNightlyCents: 6800,
    baselineFlightCents: 16500,
    hasBeach: true,
    monthlyHighC: [15, 15, 17, 20, 24, 28, 30, 30, 27, 24, 20, 17],
  },
  {
    airport: 'LCA',
    name: 'Larnaca',
    country: 'Cyprus',
    region: 'mediterranean',
    typicalFlightMinutes: 195,
    baselineHotelNightlyCents: 7200,
    baselineFlightCents: 18900,
    hasBeach: true,
    monthlyHighC: [17, 17, 20, 24, 28, 32, 35, 35, 32, 28, 23, 18],
  },
  {
    airport: 'PMI',
    name: 'Palma de Mallorca',
    country: 'Spain',
    region: 'mediterranean',
    typicalFlightMinutes: 140,
    baselineHotelNightlyCents: 8900,
    baselineFlightCents: 13500,
    hasBeach: true,
    monthlyHighC: [15, 15, 17, 19, 23, 27, 30, 31, 27, 23, 19, 16],
  },
  {
    airport: 'TBS',
    name: 'Tbilisi',
    country: 'Georgia',
    region: 'caucasus',
    typicalFlightMinutes: 200,
    baselineHotelNightlyCents: 4200,
    baselineFlightCents: 17900,
    hasBeach: false,
    monthlyHighC: [7, 9, 14, 20, 24, 28, 32, 32, 27, 20, 13, 8],
  },
  {
    airport: 'BUS',
    name: 'Batumi',
    country: 'Georgia',
    region: 'caucasus',
    typicalFlightMinutes: 205,
    baselineHotelNightlyCents: 3900,
    baselineFlightCents: 18500,
    hasBeach: true,
    monthlyHighC: [11, 11, 13, 17, 21, 25, 27, 28, 25, 21, 16, 13],
  },
  {
    airport: 'SPU',
    name: 'Split',
    country: 'Croatia',
    region: 'mediterranean',
    typicalFlightMinutes: 75,
    baselineHotelNightlyCents: 7600,
    baselineFlightCents: 11900,
    hasBeach: true,
    monthlyHighC: [11, 12, 15, 19, 24, 28, 31, 31, 26, 21, 16, 12],
  },
  {
    airport: 'FAO',
    name: 'Faro, Algarve',
    country: 'Portugal',
    region: 'atlantic',
    typicalFlightMinutes: 190,
    baselineHotelNightlyCents: 7100,
    baselineFlightCents: 15900,
    hasBeach: true,
    monthlyHighC: [16, 17, 19, 21, 23, 27, 29, 30, 27, 23, 19, 17],
  },
];

const BY_AIRPORT = new Map(DESTINATION_FIXTURES.map((entry) => [entry.airport, entry]));

export function findDestination(airport: string): DestinationFixture | undefined {
  return BY_AIRPORT.get(airport.toUpperCase());
}

/**
 * Look up a destination, falling back to a neutral synthetic profile.
 *
 * Mock providers must answer for any airport code so that exploratory queries
 * do not fail; the fallback is deliberately unremarkable rather than attractive.
 */
export function resolveDestination(airport: string): DestinationFixture {
  return (
    findDestination(airport) ?? {
      airport: airport.toUpperCase(),
      name: airport.toUpperCase(),
      country: 'Unknown',
      region: 'central_europe',
      typicalFlightMinutes: 150,
      baselineHotelNightlyCents: 7000,
      baselineFlightCents: 15000,
      hasBeach: false,
      monthlyHighC: [5, 7, 12, 17, 21, 25, 27, 27, 22, 16, 10, 6],
    }
  );
}
