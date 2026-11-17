import { describe, expect, it } from 'vitest';
import { err, ok } from '@/lib/result';
import { AppError } from '@/lib/errors';
import { nightsIn, type StayOffer, type StayQuery } from '@/core/stay/types';
import { createMockStayProvider } from './mock';
import { searchAllStays } from './fanout';
import type { StayProvider } from './types';

/**
 * The contract every stay provider has to satisfy.
 *
 * Written against the interface rather than against any adapter, so adding a
 * second provider means implementing `StayProvider` and running these - not
 * rewriting the search, the calendar, the cards or the comparison. A provider
 * that cannot pass these is a provider the rest of the product cannot use.
 */

const query: StayQuery = {
  destination: { code: 'BCN', name: 'Barcelona', position: null, radiusKm: null },
  checkIn: '2026-06-10',
  checkOut: '2026-06-14',
  occupancy: { adults: 2, children: 0, rooms: 1 },
  currency: 'EUR',
};

/** Every provider under contract. A new adapter is added to this list. */
const providers: Array<[string, () => StayProvider]> = [['mock', createMockStayProvider]];

describe.each(providers)('the %s stay provider satisfies the contract', (_name, create) => {
  const provider = create();

  it('declares its kind, and a mode that decides its provenance', () => {
    expect(provider.metadata.kind).toBe('stays');
    expect(provider.metadata.id).toBeTruthy();
    expect(provider.metadata.displayName).toBeTruthy();
    // `isMock` alone cannot tell a sandbox from a live account.
    expect(provider.metadata.mode).toBeDefined();
  });

  it('returns offers in the normalized model', async () => {
    const result = await provider.searchStays(query);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.length).toBeGreaterThan(0);

    for (const offer of result.value) {
      expect(offer.property.name).toBeTruthy();
      expect(offer.property.providerPropertyId).toBeTruthy();
      expect(offer.rates.length).toBeGreaterThan(0);

      for (const rate of offer.rates) {
        // The ids a later quote or booking call needs.
        expect(rate.providerRateId).toBeTruthy();
        expect(rate.total.currency).toBe(query.currency);
        expect(rate.total.amount).toBeGreaterThan(0);
        expect(rate.observedAt).toBeTruthy();
        expect(rate.occupancy).toEqual(query.occupancy);
      }
    }
  });

  it('prices per night as the total divided by the nights', async () => {
    const result = await provider.searchStays(query);
    if (!result.ok) throw new Error('expected offers');

    const nights = nightsIn(query);
    const rate = result.value[0]!.rates[0]!;

    // Arithmetic, never a second quote: two numbers that can disagree is a
    // total nobody can check.
    expect(Math.round(rate.total.amount / nights)).toBeCloseTo(rate.perNight.amount, -1);
  });

  it('attributes every rate to itself, and never claims to be live when it is not', async () => {
    const result = await provider.searchStays(query);
    if (!result.ok) throw new Error('expected offers');

    for (const rate of result.value.flatMap((offer) => offer.rates)) {
      expect(rate.source.providerId).toBe(provider.metadata.id);
      expect(rate.source.part).toBe('stays');

      if (provider.metadata.mode !== 'live') {
        expect(rate.source.provenance).not.toBe('live');
      }
    }
  });

  it('states an unknown as null rather than as a default', async () => {
    const result = await provider.searchStays(query);
    if (!result.ok) throw new Error('expected offers');

    for (const offer of result.value) {
      // Whatever the provider does not supply must be explicitly absent.
      // `base` and `taxesAndFees` are the common case, and a zero there
      // would be a claim that there are no taxes.
      for (const rate of offer.rates) {
        expect(rate.base === null || rate.base.amount > 0).toBe(true);
        expect(rate.taxesAndFees === null || rate.taxesAndFees.amount > 0).toBe(true);
        expect(rate.payableAtProperty === null || rate.payableAtProperty.amount > 0).toBe(true);
      }
    }
  });

  it('answers deterministically, so a suite can assert on it', async () => {
    const [first, second] = await Promise.all([
      provider.searchStays(query),
      provider.searchStays(query),
    ]);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});

describe('fanning out across providers', () => {
  /** A second provider, to prove nothing depends on there being one. */
  const secondProvider = (offers: readonly StayOffer[]): StayProvider => ({
    metadata: {
      id: 'provider-b',
      kind: 'stays',
      displayName: 'Provider B',
      isMock: true,
      mode: 'mock',
      rateLimitPerMinute: null,
    },
    searchStays: async () => ok(offers),
  });

  const failing: StayProvider = {
    metadata: {
      id: 'provider-c',
      kind: 'stays',
      displayName: 'Provider C',
      isMock: true,
      mode: 'mock',
      rateLimitPerMinute: null,
    },
    searchStays: async () => err(new AppError('PROVIDER_UNAVAILABLE', 'down')),
  };

  const throwing: StayProvider = {
    metadata: {
      id: 'provider-d',
      kind: 'stays',
      displayName: 'Provider D',
      isMock: true,
      mode: 'mock',
      rateLimitPerMinute: null,
    },
    searchStays: async () => {
      throw new Error('adapter bug');
    },
  };

  it('merges several providers into one result set', async () => {
    const mock = createMockStayProvider();
    const mine = await mock.searchStays(query);
    if (!mine.ok) throw new Error('expected offers');

    const result = await searchAllStays([mock, secondProvider(mine.value)], query);

    // Same properties from two providers: one entry each, two offers each.
    expect(result.answered).toEqual(['mock-stays', 'provider-b']);
    expect(result.stays.length).toBe(mine.value.length);
    expect(result.stays[0]!.offers).toHaveLength(2);
  });

  it('keeps going when one provider fails', async () => {
    const result = await searchAllStays([createMockStayProvider(), failing], query);

    // The page is not empty because one vendor is down.
    expect(result.stays.length).toBeGreaterThan(0);
    expect(result.answered).toEqual(['mock-stays']);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.providerId).toBe('provider-c');
  });

  it('survives an adapter that throws instead of returning', async () => {
    const result = await searchAllStays([createMockStayProvider(), throwing], query);

    expect(result.stays.length).toBeGreaterThan(0);
    expect(result.failures[0]?.providerId).toBe('provider-d');
  });

  it('returns nothing rather than throwing when every provider fails', async () => {
    const result = await searchAllStays([failing, throwing], query);

    expect(result.stays).toEqual([]);
    expect(result.failures).toHaveLength(2);
  });
});
