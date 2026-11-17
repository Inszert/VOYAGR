import { describe, expect, it, vi } from 'vitest';
import { createMemoryRepositories } from '@/db/memory';
import { costTripCandidate } from '@/core/trip/cost';
import { buildCandidate } from '@/core/trip/test-support';
import { STORED_SCHEMA_VERSION, toStoredRates } from '@/liteapi-snapshot/stored-schema';
import { ratesKey } from '@/liteapi-snapshot/targets';
import { aProperty, aRate } from '@/liteapi-snapshot/test-support';
import type { StayRate } from '@/core/stay/types';
import type { HotelSearchQuery } from '../types';
import { createSnapshotHotelProvider, SnapshotHotelProvider } from './liteapi';

const OBSERVED = '2027-01-10T08:00:00.000Z';
const HOUR = 3_600_000;
const FRESH_NOW = Date.parse(OBSERVED) + 5 * HOUR;
const AGING_NOW = Date.parse(OBSERVED) + 20 * HOUR;
const FUTURE_NOW = Date.parse(OBSERVED) - 2 * HOUR;
const EXPIRED_NOW = Date.parse(OBSERVED) + 30 * HOUR;

const query: HotelSearchQuery = {
  destination: 'LIS',
  checkIn: '2027-02-09',
  checkOut: '2027-02-13',
  guests: 2,
  currency: 'EUR',
};

async function providerAt(now: number, rates: readonly StayRate[] = [aRate]) {
  const repositories = createMemoryRepositories({ now: () => now });
  await repositories.liteapiSnapshot.putRates({
    ...ratesKey({
      destinationCode: 'LIS',
      checkIn: query.checkIn,
      checkOut: query.checkOut,
      occupancy: { adults: 2, children: 0, rooms: 1 },
      currency: 'EUR',
      guestNationality: 'US',
    }),
    environment: 'sandbox',
    schemaVersion: STORED_SCHEMA_VERSION,
    rates: toStoredRates([{ property: aProperty, rates }]),
    observedAt: OBSERVED,
    expiresAt: '2027-01-11T08:00:00.000Z',
    runId: 'r',
  });
  return new SnapshotHotelProvider('test', {
    now: () => now,
    dependencies: () => ({
      repository: repositories.liteapiSnapshot,
      refreshesPerDay: 3,
      guestNationality: 'US',
    }),
  });
}

async function offersFrom(provider: SnapshotHotelProvider, q: HotelSearchQuery = query) {
  const result = await provider.searchHotels(q);
  if (!result.ok) throw result.error;
  return result.value.items;
}

describe('the snapshot hotel provider', () => {
  it('is labelled test for a sandbox key and live for a production key', () => {
    expect(createSnapshotHotelProvider({ LITEAPI_API_KEY: 'sand_x' }).metadata).toMatchObject({
      id: 'liteapi',
      kind: 'hotels',
      isMock: false,
      mode: 'test',
    });
    expect(createSnapshotHotelProvider({ LITEAPI_API_KEY: 'prod_x' }).metadata.mode).toBe('live');
  });

  it('prices from the stored row with no fetch, and keeps payable-at-hotel money as an excluded fee', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const [offer] = await offersFrom(await providerAt(FRESH_NOW));

    expect(offer).toMatchObject({
      providerId: 'liteapi',
      name: 'Hotel Alfama',
      totalPrice: { amount: 33333, currency: 'EUR' },
      excludedFees: { amount: 400, currency: 'EUR' },
      freeCancellation: true,
      observedAt: OBSERVED,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('puts the stored price in the trip total and the hotel fee outside it', async () => {
    const [offer] = await offersFrom(await providerAt(FRESH_NOW));
    const cost = costTripCandidate(buildCandidate({ hotel: offer!, transfer: null }));
    const flight = cost.lines.find((line) => line.category === 'flight')!;

    expect(cost.total.amount).toBe(flight.amount.amount + 33333);
    expect(cost.excluded.some((line) => line.category === 'hotel_fees')).toBe(true);
    expect(cost.excluded.find((line) => line.category === 'hotel_fees')?.amount.amount).toBe(400);
  });

  it('still prices an aging row, and a row observed in the future with no age claim', async () => {
    const aging = await offersFrom(await providerAt(AGING_NOW));
    const future = await offersFrom(await providerAt(FUTURE_NOW));

    expect(aging).toHaveLength(1);
    expect(future).toHaveLength(1);
    expect(future[0]!.totalPrice.amount).toBe(33333);
  });

  it('gives no price, not a zero and not an error, when the row is missing or expired', async () => {
    const expired = await offersFrom(await providerAt(EXPIRED_NOW));
    const otherDates = await offersFrom(await providerAt(FRESH_NOW), {
      ...query,
      checkOut: '2027-02-14',
    });
    const otherParty = await offersFrom(await providerAt(FRESH_NOW), { ...query, guests: 3 });

    expect(expired).toEqual([]);
    expect(otherDates).toEqual([]);
    expect(otherParty).toEqual([]);

    // The trip is then assembled with no stay, which the cost engine names and leaves out.
    const cost = costTripCandidate(buildCandidate({ hotel: null, transfer: null }));
    const stay = cost.excluded.find((line) => line.category === 'hotel');
    expect(stay?.label).toBe('Stay not priced');
    expect(stay?.amount.amount).toBe(0);
  });

  it('offers the cheapest rate per property, and the cheapest refundable one when required', async () => {
    const cheaperNonRefundable: StayRate = {
      ...aRate,
      id: 'liteapi:lp1001:offer-2',
      cancellation: { refundable: false, deadline: null, description: null },
      total: { amount: 30000, currency: 'EUR' },
      perNight: { amount: 7500, currency: 'EUR' },
    };
    const provider = await providerAt(FRESH_NOW, [aRate, cheaperNonRefundable]);

    const cheapest = await offersFrom(provider);
    const refundable = await offersFrom(provider, { ...query, freeCancellationOnly: true });

    expect(cheapest).toHaveLength(1);
    expect(cheapest[0]!.totalPrice.amount).toBe(30000);
    expect(cheapest[0]!.freeCancellation).toBe(false);
    expect(refundable[0]!.totalPrice.amount).toBe(33333);
  });

  it('degrades to an error result, never a throw, when the database cannot be read', async () => {
    const provider = new SnapshotHotelProvider('test', {
      dependencies: () => ({
        repository: {
          getRates: async () => {
            throw new Error('connection refused');
          },
        },
        refreshesPerDay: 3,
        guestNationality: 'US',
      }),
    });

    expect((await provider.searchHotels(query)).ok).toBe(false);
  });
});
