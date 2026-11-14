import { describe, expect, it } from 'vitest';
import { fromMajor } from '@/core/money';
import type { FlightOffer, FlightLeg } from '@/core/trip/types';
import { flightMatchesWindow } from './assemble';
import { calendarFlightsFromOffers, windowsFromOffers } from './derive-windows';

const leg = (from: string, to: string, day: string): FlightLeg => ({
  segments: [
    {
      origin: from,
      destination: to,
      departsAt: `${day}T08:00` as FlightLeg['segments'][number]['departsAt'],
      arrivesAt: `${day}T08:00` as FlightLeg['segments'][number]['arrivesAt'],
      carrier: 'W6',
      flightNumber: 'W62429',
    },
  ],
  durationMinutes: 200,
  cabinBaggageIncluded: null,
  checkedBaggageIncluded: null,
  selfTransfer: null,
});

const offer = (to: string, out: string, back: string, euros: number): FlightOffer => ({
  id: `${to}-${out}-${back}-${euros}`,
  providerId: 'aviasales',
  outbound: leg('BUD', to, out),
  inbound: leg(to, 'BUD', back),
  price: fromMajor(euros, 'EUR'),
  observedAt: '2026-11-05T00:00:00.000Z' as FlightOffer['observedAt'],
  expiresAt: null,
});

const bounds = {
  earliestDeparture: '2026-12-01' as const,
  latestReturn: '2026-12-31' as const,
  minNights: 3,
  maxNights: 10,
};

describe('flightMatchesWindow', () => {
  const window = {
    departureDate: '2026-12-07' as const,
    returnDate: '2026-12-12' as const,
    nights: 5,
  };

  it('accepts a flight on exactly the window days', () => {
    expect(flightMatchesWindow(offer('AYT', '2026-12-07', '2026-12-12', 150), window)).toBe(true);
  });

  it('refuses a flight on other days, so a trip never claims dates it does not fly', () => {
    expect(flightMatchesWindow(offer('AYT', '2026-12-08', '2026-12-12', 150), window)).toBe(false);
    expect(flightMatchesWindow(offer('AYT', '2026-12-07', '2026-12-13', 150), window)).toBe(false);
  });
});

describe('windowsFromOffers', () => {
  it('reads the windows off the days the flights fly', () => {
    const windows = windowsFromOffers(
      [offer('AYT', '2026-12-07', '2026-12-12', 150), offer('LIS', '2026-12-09', '2026-12-14', 90)],
      bounds,
      2,
      10,
    );

    expect(windows).toEqual([
      { departureDate: '2026-12-07', returnDate: '2026-12-12', nights: 5 },
      { departureDate: '2026-12-09', returnDate: '2026-12-14', nights: 5 },
    ]);
  });

  it('drops pairs outside the requested span or night range', () => {
    const windows = windowsFromOffers(
      [
        offer('AYT', '2026-11-20', '2026-11-25', 100), // before the span
        offer('AYT', '2026-12-28', '2027-01-03', 100), // returns after it
        offer('AYT', '2026-12-05', '2026-12-06', 100), // one night, under the minimum
        offer('AYT', '2026-12-05', '2026-12-25', 100), // twenty nights, over the maximum
      ],
      bounds,
      2,
      10,
    );

    expect(windows).toEqual([]);
  });

  it('keeps each destination to its cheapest pairs and caps the total', () => {
    const windows = windowsFromOffers(
      [
        offer('AYT', '2026-12-03', '2026-12-08', 300),
        offer('AYT', '2026-12-04', '2026-12-09', 100),
        offer('AYT', '2026-12-05', '2026-12-10', 200),
      ],
      bounds,
      2,
      10,
    );

    expect(windows.map((w) => w.departureDate)).toEqual(['2026-12-04', '2026-12-05']);
    expect(
      windowsFromOffers([offer('AYT', '2026-12-04', '2026-12-09', 100)], bounds, 2, 0),
    ).toEqual([]);
  });

  it('keeps only the days of the week a weekend search allows', () => {
    // 2026-12-04 is a Friday, 2026-12-09 a Wednesday.
    const windows = windowsFromOffers(
      [offer('AYT', '2026-12-04', '2026-12-06', 100), offer('AYT', '2026-12-09', '2026-12-11', 50)],
      { ...bounds, minNights: 2, departureDaysOfWeek: [5, 6], returnDaysOfWeek: [0] },
      2,
      10,
    );

    expect(windows.map((w) => w.departureDate)).toEqual(['2026-12-04']);
  });

  it('returns nothing when there are no flights', () => {
    expect(windowsFromOffers([], bounds, 2, 10)).toEqual([]);
  });

  it('covers the days nobody picked, so the calendar is not mostly empty', () => {
    const offers = [
      offer('AYT', '2026-12-03', '2026-12-08', 120),
      offer('AYT', '2026-12-04', '2026-12-09', 300),
      offer('AYT', '2026-12-05', '2026-12-10', 280),
      offer('AYT', '2026-12-06', '2026-12-11', 260),
    ];

    // The cheapest pair alone leaves three days with no price on them.
    expect(windowsFromOffers(offers, bounds, 1, 1)).toHaveLength(1);

    // Coverage adds the cheapest pair on each remaining day, earliest first.
    const covered = windowsFromOffers(offers, bounds, 1, 1, 2);
    expect(covered.map((window) => window.departureDate)).toEqual([
      '2026-12-03',
      '2026-12-04',
      '2026-12-05',
    ]);
  });

  it('adds one pair per day, and the cheapest of them', () => {
    const offers = [
      offer('AYT', '2026-12-03', '2026-12-08', 120),
      offer('AYT', '2026-12-04', '2026-12-10', 400),
      offer('AYT', '2026-12-04', '2026-12-09', 300),
    ];

    const windows = windowsFromOffers(offers, bounds, 1, 1, 5);

    expect(windows).toHaveLength(2);
    expect(windows.find((window) => window.departureDate === '2026-12-04')?.returnDate).toBe(
      '2026-12-09',
    );
  });
});

describe('calendarFlightsFromOffers', () => {
  it('gives the cheapest flight on each departure day, whatever the date window', () => {
    const flights = calendarFlightsFromOffers(
      [
        offer('AYT', '2026-12-03', '2026-12-08', 220),
        offer('SPU', '2026-12-03', '2026-12-09', 140),
        offer('AYT', '2026-12-20', '2026-12-25', 310),
      ],
      { minNights: 3, maxNights: 10 },
    );

    expect(
      flights.map((flight) => [flight.departureDate, flight.price.amount, flight.destination]),
    ).toEqual([
      ['2026-12-03', 14000, 'SPU'],
      ['2026-12-20', 31000, 'AYT'],
    ]);
  });

  it('holds the stay to the length that was asked for', () => {
    // A two-night fare is not an answer to a search for four to seven nights.
    const flights = calendarFlightsFromOffers(
      [offer('AYT', '2026-12-03', '2026-12-05', 90), offer('AYT', '2026-12-04', '2026-12-09', 200)],
      { minNights: 4, maxNights: 7 },
    );

    expect(flights.map((flight) => flight.departureDate)).toEqual(['2026-12-04']);
  });

  it('says nothing for a day with no flight rather than guessing one', () => {
    expect(calendarFlightsFromOffers([], { minNights: 1, maxNights: 30 })).toEqual([]);
  });
});
