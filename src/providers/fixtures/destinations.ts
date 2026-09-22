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
  /**
   * Natural Earth `ADM0_A3` for the country, so the globe can put the place
   * inside a border rather than merely near one. Null for the synthetic
   * fallback, which is nowhere.
   */
  readonly adm0: string | null;
  readonly region:
    | 'mediterranean'
    | 'caucasus'
    | 'atlantic'
    | 'central_europe'
    | 'nordic'
    | 'north_america'
    | 'middle_east'
    | 'asia'
    | 'africa';
  /** Typical flight time in minutes from Vienna, used to shape mock offers. */
  readonly typicalFlightMinutes: number;
  /** Baseline nightly hotel price in minor units (EUR cents) for a mid-range room. */
  readonly baselineHotelNightlyCents: number;
  /** Baseline return flight price per passenger, in EUR cents. */
  readonly baselineFlightCents: number;
  readonly hasBeach: boolean;
  /** Mean daily maximum in Celsius by month index (0 = January). */
  readonly monthlyHighC: readonly number[];
  /**
   * Airport position, `[longitude, latitude]` - GeoJSON order, not the
   * latitude-first order people say out loud. Getting it the wrong way round
   * puts Antalya in the Indian Ocean, so the order is stated rather than
   * assumed.
   *
   * Hand-entered development data to two decimal places, about a kilometre,
   * which is the resolution a map marker at country zoom can express. Like
   * everything else in this file it is a stand-in for the `destinations` table
   * (specification section 21) and nothing costs, constrains or scores from it.
   */
  readonly position: readonly [number, number];
}

export const DESTINATION_FIXTURES: readonly DestinationFixture[] = [
  {
    airport: 'AYT',
    name: 'Antalya',
    country: 'Turkey',
    adm0: 'TUR',
    region: 'mediterranean',
    typicalFlightMinutes: 165,
    baselineHotelNightlyCents: 5400,
    baselineFlightCents: 14900,
    hasBeach: true,
    monthlyHighC: [15, 16, 19, 23, 27, 33, 36, 36, 32, 27, 21, 16],
    position: [30.79, 36.9],
  },
  {
    airport: 'CHQ',
    name: 'Chania, Crete',
    country: 'Greece',
    adm0: 'GRC',
    region: 'mediterranean',
    typicalFlightMinutes: 150,
    baselineHotelNightlyCents: 6800,
    baselineFlightCents: 16500,
    hasBeach: true,
    monthlyHighC: [15, 15, 17, 20, 24, 28, 30, 30, 27, 24, 20, 17],
    position: [24.15, 35.53],
  },
  {
    airport: 'LCA',
    name: 'Larnaca',
    country: 'Cyprus',
    adm0: 'CYP',
    region: 'mediterranean',
    typicalFlightMinutes: 195,
    baselineHotelNightlyCents: 7200,
    baselineFlightCents: 18900,
    hasBeach: true,
    monthlyHighC: [17, 17, 20, 24, 28, 32, 35, 35, 32, 28, 23, 18],
    position: [33.63, 34.88],
  },
  {
    airport: 'PMI',
    name: 'Palma de Mallorca',
    country: 'Spain',
    adm0: 'ESP',
    region: 'mediterranean',
    typicalFlightMinutes: 140,
    baselineHotelNightlyCents: 8900,
    baselineFlightCents: 13500,
    hasBeach: true,
    monthlyHighC: [15, 15, 17, 19, 23, 27, 30, 31, 27, 23, 19, 16],
    position: [2.74, 39.55],
  },
  {
    airport: 'TBS',
    name: 'Tbilisi',
    country: 'Georgia',
    adm0: 'GEO',
    region: 'caucasus',
    typicalFlightMinutes: 200,
    baselineHotelNightlyCents: 4200,
    baselineFlightCents: 17900,
    hasBeach: false,
    monthlyHighC: [7, 9, 14, 20, 24, 28, 32, 32, 27, 20, 13, 8],
    position: [44.95, 41.67],
  },
  {
    airport: 'BUS',
    name: 'Batumi',
    country: 'Georgia',
    adm0: 'GEO',
    region: 'caucasus',
    typicalFlightMinutes: 205,
    baselineHotelNightlyCents: 3900,
    baselineFlightCents: 18500,
    hasBeach: true,
    monthlyHighC: [11, 11, 13, 17, 21, 25, 27, 28, 25, 21, 16, 13],
    position: [41.6, 41.61],
  },
  {
    airport: 'SPU',
    name: 'Split',
    country: 'Croatia',
    adm0: 'HRV',
    region: 'mediterranean',
    typicalFlightMinutes: 75,
    baselineHotelNightlyCents: 7600,
    baselineFlightCents: 11900,
    hasBeach: true,
    monthlyHighC: [11, 12, 15, 19, 24, 28, 31, 31, 26, 21, 16, 12],
    position: [16.3, 43.54],
  },
  {
    airport: 'FAO',
    name: 'Faro, Algarve',
    country: 'Portugal',
    adm0: 'PRT',
    region: 'atlantic',
    typicalFlightMinutes: 190,
    baselineHotelNightlyCents: 7100,
    baselineFlightCents: 15900,
    hasBeach: true,
    monthlyHighC: [16, 17, 19, 21, 23, 27, 29, 30, 27, 23, 19, 17],
    position: [-7.97, 37.01],
  },
  /*
   * Farther afield, so the globe is a globe.
   *
   * The Mediterranean set above is what the product specification's examples
   * use. These eight exist because a discovery surface that is a planet needs
   * routes that cross it: on a sphere, eight places within thirty degrees of
   * each other are a cluster, not a world. Same status as the rest of this
   * file - development data, approximate climate normals, not a catalogue.
   */
  {
    airport: 'LIS',
    name: 'Lisbon',
    country: 'Portugal',
    adm0: 'PRT',
    region: 'atlantic',
    typicalFlightMinutes: 200,
    baselineHotelNightlyCents: 9500,
    baselineFlightCents: 15900,
    hasBeach: true,
    monthlyHighC: [15, 16, 18, 20, 22, 26, 28, 29, 27, 23, 18, 15],
    position: [-9.13, 38.77],
  },
  {
    airport: 'KEF',
    name: 'Reykjavik',
    country: 'Iceland',
    adm0: 'ISL',
    region: 'nordic',
    typicalFlightMinutes: 260,
    baselineHotelNightlyCents: 15500,
    baselineFlightCents: 24900,
    hasBeach: false,
    monthlyHighC: [3, 3, 4, 7, 10, 13, 15, 14, 11, 8, 5, 4],
    position: [-22.61, 63.98],
  },
  {
    airport: 'JFK',
    name: 'New York',
    country: 'United States',
    adm0: 'USA',
    region: 'north_america',
    typicalFlightMinutes: 560,
    baselineHotelNightlyCents: 24000,
    baselineFlightCents: 62000,
    hasBeach: false,
    monthlyHighC: [4, 6, 11, 17, 22, 27, 30, 29, 25, 18, 12, 7],
    position: [-73.78, 40.64],
  },
  {
    airport: 'DXB',
    name: 'Dubai',
    country: 'United Arab Emirates',
    adm0: 'ARE',
    region: 'middle_east',
    typicalFlightMinutes: 350,
    baselineHotelNightlyCents: 14500,
    baselineFlightCents: 39000,
    hasBeach: true,
    monthlyHighC: [24, 25, 28, 33, 38, 40, 41, 41, 39, 35, 30, 26],
    position: [55.36, 25.25],
  },
  {
    airport: 'BKK',
    name: 'Bangkok',
    country: 'Thailand',
    adm0: 'THA',
    region: 'asia',
    typicalFlightMinutes: 640,
    baselineHotelNightlyCents: 6500,
    baselineFlightCents: 58000,
    hasBeach: false,
    monthlyHighC: [33, 33, 34, 35, 34, 33, 33, 33, 32, 32, 32, 32],
    position: [100.75, 13.69],
  },
  {
    airport: 'NRT',
    name: 'Tokyo',
    country: 'Japan',
    adm0: 'JPN',
    region: 'asia',
    typicalFlightMinutes: 700,
    baselineHotelNightlyCents: 16000,
    baselineFlightCents: 74000,
    hasBeach: false,
    monthlyHighC: [10, 10, 13, 19, 23, 26, 30, 31, 27, 22, 17, 12],
    position: [140.39, 35.77],
  },
  {
    airport: 'CPT',
    name: 'Cape Town',
    country: 'South Africa',
    adm0: 'ZAF',
    region: 'africa',
    typicalFlightMinutes: 780,
    baselineHotelNightlyCents: 9800,
    baselineFlightCents: 69000,
    hasBeach: true,
    monthlyHighC: [26, 27, 25, 23, 20, 18, 18, 18, 19, 21, 24, 25],
    position: [18.6, -33.97],
  },
  {
    airport: 'DPS',
    name: 'Bali',
    country: 'Indonesia',
    adm0: 'IDN',
    region: 'asia',
    typicalFlightMinutes: 900,
    baselineHotelNightlyCents: 7200,
    baselineFlightCents: 81000,
    hasBeach: true,
    monthlyHighC: [31, 31, 31, 32, 31, 30, 30, 30, 31, 32, 32, 31],
    position: [115.17, -8.75],
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
      adm0: null,
      region: 'central_europe',
      typicalFlightMinutes: 150,
      baselineHotelNightlyCents: 7000,
      baselineFlightCents: 15000,
      hasBeach: false,
      monthlyHighC: [5, 7, 12, 17, 21, 25, 27, 27, 22, 16, 10, 6],
      // Null Island, and deliberately so: an unknown airport has no position,
      // and the map drops a destination it cannot place rather than inventing
      // somewhere plausible for it.
      position: [0, 0],
    }
  );
}
