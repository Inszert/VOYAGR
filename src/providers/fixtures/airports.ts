/**
 * Departure airports the mocks know where to put on a map.
 *
 * The destination fixtures place destinations; nothing placed an origin, so
 * the globe could not draw a route from anywhere. This is the other end of
 * every arc. Like the destinations it is development data standing in for the
 * `destinations` table (specification section 21), and nothing costs,
 * constrains or scores from it.
 *
 * Positions are `[longitude, latitude]` to two decimal places, hand-entered
 * from published airport coordinates. An origin absent from this list draws no
 * arc rather than an invented one.
 */

export interface AirportFixture {
  readonly code: string;
  readonly name: string;
  readonly city: string;
  readonly country: string;
  /** Natural Earth `ADM0_A3`, so an airport can be placed inside a country. */
  readonly adm0: string;
  readonly position: readonly [number, number];
}

export const AIRPORT_FIXTURES: readonly AirportFixture[] = [
  {
    code: 'VIE',
    name: 'Vienna',
    city: 'Vienna',
    country: 'Austria',
    adm0: 'AUT',
    position: [16.57, 48.11],
  },
  {
    code: 'GRZ',
    name: 'Graz',
    city: 'Graz',
    country: 'Austria',
    adm0: 'AUT',
    position: [15.44, 46.99],
  },
  {
    code: 'LNZ',
    name: 'Linz',
    city: 'Linz',
    country: 'Austria',
    adm0: 'AUT',
    position: [14.19, 48.23],
  },
  {
    code: 'SZG',
    name: 'Salzburg',
    city: 'Salzburg',
    country: 'Austria',
    adm0: 'AUT',
    position: [13.0, 47.79],
  },
  {
    code: 'INN',
    name: 'Innsbruck',
    city: 'Innsbruck',
    country: 'Austria',
    adm0: 'AUT',
    position: [11.34, 47.26],
  },
  {
    code: 'BTS',
    name: 'Bratislava',
    city: 'Bratislava',
    country: 'Slovakia',
    adm0: 'SVK',
    position: [17.21, 48.17],
  },
  {
    code: 'BUD',
    name: 'Budapest',
    city: 'Budapest',
    country: 'Hungary',
    adm0: 'HUN',
    position: [19.26, 47.44],
  },
  {
    code: 'PRG',
    name: 'Prague',
    city: 'Prague',
    country: 'Czechia',
    adm0: 'CZE',
    position: [14.26, 50.1],
  },
  {
    code: 'MUC',
    name: 'Munich',
    city: 'Munich',
    country: 'Germany',
    adm0: 'DEU',
    position: [11.79, 48.35],
  },
  {
    code: 'FRA',
    name: 'Frankfurt',
    city: 'Frankfurt',
    country: 'Germany',
    adm0: 'DEU',
    position: [8.57, 50.03],
  },
  {
    code: 'BER',
    name: 'Berlin Brandenburg',
    city: 'Berlin',
    country: 'Germany',
    adm0: 'DEU',
    position: [13.5, 52.36],
  },
  {
    code: 'ZRH',
    name: 'Zurich',
    city: 'Zurich',
    country: 'Switzerland',
    adm0: 'CHE',
    position: [8.55, 47.46],
  },
  {
    code: 'AMS',
    name: 'Amsterdam Schiphol',
    city: 'Amsterdam',
    country: 'Netherlands',
    adm0: 'NLD',
    position: [4.76, 52.31],
  },
  {
    code: 'LHR',
    name: 'London Heathrow',
    city: 'London',
    country: 'United Kingdom',
    adm0: 'GBR',
    position: [-0.46, 51.47],
  },
  {
    code: 'CDG',
    name: 'Paris Charles de Gaulle',
    city: 'Paris',
    country: 'France',
    adm0: 'FRA',
    position: [2.55, 49.01],
  },
  {
    code: 'WAW',
    name: 'Warsaw Chopin',
    city: 'Warsaw',
    country: 'Poland',
    adm0: 'POL',
    position: [20.97, 52.17],
  },
];

const BY_CODE = new Map(AIRPORT_FIXTURES.map((entry) => [entry.code, entry]));

export function findAirport(code: string): AirportFixture | undefined {
  return BY_CODE.get(code.toUpperCase());
}
