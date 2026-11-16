import { describe, expect, it } from 'vitest';
import { money } from '../money';
import { buildFlightOffer, buildLeg } from './test-support';
import { pairOneWayFares, withPairs } from './one-way-pair';
import type { OneWayFare } from './types';

function fare(
  from: string,
  to: string,
  day: string,
  amount: number,
  id = `${from}${to}${day}`,
): OneWayFare {
  return {
    id,
    providerId: 'aviasales',
    leg: buildLeg({
      segments: [
        {
          origin: from,
          destination: to,
          departsAt: `${day}T08:00`,
          arrivesAt: null,
          carrier: 'XX',
          flightNumber: 'XX1',
        },
      ],
      cabinBaggageIncluded: null,
      checkedBaggageIncluded: null,
      selfTransfer: null,
    }),
    price: money(amount, 'EUR'),
    observedAt: day === '2026-11-03' ? '2026-10-30T00:00:00.000Z' : '2026-11-01T00:00:00.000Z',
    deepLink: `https://www.aviasales.com/search/${from}${to}`,
  };
}

describe('pairOneWayFares', () => {
  it('builds a trip from an outbound and a return the right number of nights apart', () => {
    const pairs = pairOneWayFares(
      [fare('VIE', 'KZN', '2026-11-03', 12_000)],
      [fare('KZN', 'VIE', '2026-11-10', 9_500), fare('KZN', 'VIE', '2026-11-20', 7_000)],
      { minNights: 7, maxNights: 7 },
    );

    expect(pairs).toHaveLength(1);
    const [pair] = pairs;
    // Summed exactly, on Money.
    expect(pair!.price).toEqual(money(21_500, 'EUR'));
    expect(pair!.ticketing).toBe('two_one_way');
    // Both bookings keep their own link.
    expect(pair!.deepLink).toContain('VIEKZN');
    expect(pair!.returnDeepLink).toContain('KZNVIE');
    // As fresh as its older half.
    expect(pair!.observedAt).toBe('2026-10-30T00:00:00.000Z');
  });

  it('uses the cheapest fare on each day', () => {
    const [pair] = pairOneWayFares(
      [
        fare('VIE', 'KZN', '2026-11-03', 12_000, 'a'),
        fare('VIE', 'KZN', '2026-11-03', 10_000, 'b'),
      ],
      [fare('KZN', 'VIE', '2026-11-10', 9_500)],
      { minNights: 7, maxNights: 7 },
    );
    expect(pair!.price).toEqual(money(19_500, 'EUR'));
  });

  it('pairs nothing when no return falls inside the stay', () => {
    expect(
      pairOneWayFares(
        [fare('VIE', 'KZN', '2026-11-03', 1)],
        [fare('KZN', 'VIE', '2026-11-05', 1)],
        {
          minNights: 7,
          maxNights: 7,
        },
      ),
    ).toEqual([]);
  });
});

describe('withPairs', () => {
  const roundTrip = (amount: number) =>
    buildFlightOffer({
      id: `rt-${amount}`,
      price: money(amount, 'EUR'),
      outbound: buildLeg({
        segments: [
          {
            origin: 'VIE',
            destination: 'KZN',
            departsAt: '2026-11-03T08:00',
            arrivesAt: null,
            carrier: 'XX',
            flightNumber: 'XX1',
          },
        ],
      }),
      inbound: buildLeg({
        segments: [
          {
            origin: 'KZN',
            destination: 'VIE',
            departsAt: '2026-11-10T08:00',
            arrivesAt: null,
            carrier: 'XX',
            flightNumber: 'XX2',
          },
        ],
      }),
    });
  const pair = pairOneWayFares(
    [fare('VIE', 'KZN', '2026-11-03', 12_000)],
    [fare('KZN', 'VIE', '2026-11-10', 9_500)],
    { minNights: 7, maxNights: 7 },
  );

  it('keeps a pair for days no return fare covers', () => {
    expect(withPairs([], pair)).toHaveLength(1);
  });

  it('lets a cheaper or equal return fare win', () => {
    expect(withPairs([roundTrip(21_500)], pair).map((o) => o.id)).toEqual(['rt-21500']);
    expect(withPairs([roundTrip(20_000)], pair).map((o) => o.id)).toEqual(['rt-20000']);
  });

  it('keeps the pair beside a dearer return fare, so the cheaper can be shown', () => {
    expect(withPairs([roundTrip(30_000)], pair)).toHaveLength(2);
  });
});
