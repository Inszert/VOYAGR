import { describe, expect, it } from 'vitest';
import type { KiwiOffersKey, KiwiOffersRow } from '@/db/repository';
import { findHubSaving } from './hub-saving';

const NOW = Date.parse('2027-01-10T12:00:00.000Z');
const point = (code: string, latitude: number, longitude: number) => ({
  code,
  latitude,
  longitude,
  size: 'large' as const,
});
// VIE and BTS are about 55 km apart: the 60 km band, a 15.00 EUR transfer estimate.
const airports = [point('VIE', 48.11, 16.57), point('BTS', 48.17, 17.2)];

function repo(prices: Record<string, number | null>, observedAt = '2027-01-10T10:00:00.000Z') {
  const asked: string[] = [];
  return {
    asked,
    get: async (key: KiwiOffersKey): Promise<KiwiOffersRow | null> => {
      asked.push(key.origin);
      const amount = prices[key.origin];
      if (amount === undefined || amount === null) return null;
      return {
        ...key,
        schemaVersion: 1,
        observedAt,
        offers: [{ price: { amount, currency: key.currency } }],
      };
    },
  };
}

const base = {
  origin: 'VIE',
  destination: 'BCN',
  departureDate: '2027-02-09',
  returnDate: '2027-02-13',
  adults: 1,
  currency: 'EUR',
  airports,
  now: () => NOW,
};

describe('findHubSaving', () => {
  it('reports a material saving including the transfer estimate', async () => {
    const saving = await findHubSaving({
      ...base,
      requestedFlightMinor: 20000,
      offers: repo({ BTS: 8000 }),
    });
    expect(saving).toEqual({
      origin: 'VIE',
      code: 'BTS',
      savingMinor: 20000 - (8000 + 1500),
      transferMinor: 1500,
      currency: 'EUR',
    });
  });

  it('stays quiet below the amount threshold', async () => {
    // total 18600 vs 20000: saving 1400 < 1500
    expect(
      await findHubSaving({ ...base, requestedFlightMinor: 20000, offers: repo({ BTS: 17100 }) }),
    ).toBeNull();
  });

  it('stays quiet below the percentage threshold', async () => {
    // saving 2000 on 100000 is 2 percent
    expect(
      await findHubSaving({ ...base, requestedFlightMinor: 100000, offers: repo({ BTS: 96500 }) }),
    ).toBeNull();
  });

  it('shows the line at exactly both thresholds', async () => {
    // requested 15000, candidate total 13500: saving 1500 = 10 percent
    const saving = await findHubSaving({
      ...base,
      requestedFlightMinor: 15000,
      offers: repo({ BTS: 12000 }),
    });
    expect(saving?.savingMinor).toBe(1500);
  });

  it('stays quiet when no candidate is priced, and a stale price is not a price', async () => {
    expect(
      await findHubSaving({ ...base, requestedFlightMinor: 20000, offers: repo({}) }),
    ).toBeNull();
    expect(
      await findHubSaving({
        ...base,
        requestedFlightMinor: 20000,
        offers: repo({ BTS: 1000 }, '2027-01-09T20:00:00.000Z'),
      }),
    ).toBeNull();
  });

  it('makes no line outside EUR, where the transfer estimate cannot be converted', async () => {
    const offers = repo({ BTS: 1000 });
    expect(
      await findHubSaving({ ...base, currency: 'GBP', requestedFlightMinor: 20000, offers }),
    ).toBeNull();
    expect(offers.asked).toEqual([]);
  });
});
