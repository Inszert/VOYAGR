import { describe, expect, it } from 'vitest';
import { MemoryCacheStore } from '@/cache/memory';
import { addDays } from '@/core/dates';
import { money } from '@/core/money';
import type { FlightOffer } from '@/core/trip/types';
import { AppError } from '@/lib/errors';
import { createLimiterPool } from '@/lib/concurrency';
import { err, ok } from '@/lib/result';
import { createMockFlightProvider } from '@/providers/flights/mock';
import type { FlightProvider, FlightSearchQuery } from '@/providers/types';
import { loadMonthDayPrices } from './day-prices';

/**
 * The per-day price loader behind the calendar and the flexible-dates strip.
 *
 * What is defended: a month is one cache entry however many calls built it, a
 * warm entry costs no call, a failing vendor degrades to no prices without
 * throwing and without being remembered, and a day the vendor has no flight on
 * is absent rather than filled in.
 */

const NOW = Date.parse('2026-11-14T12:00:00.000Z');

function offer(day: string, nights: number, amount: number, currency = 'EUR'): FlightOffer {
  return {
    id: `${day}-${nights}`,
    providerId: 'fake',
    outbound: { segments: [{ departsAt: `${day}T08:00` }] },
    inbound: { segments: [{ departsAt: `${addDays(day, nights)}T18:00` }] },
    price: money(amount, currency),
    observedAt: '2026-11-14T11:55:00.000Z',
    expiresAt: null,
  } as unknown as FlightOffer;
}

/** A vendor that answers by month, with no flights on the 5th and 6th. */
function fakeVendor(options: { fail?: boolean } = {}) {
  const calls: FlightSearchQuery[] = [];

  const provider = {
    metadata: {
      id: 'fake',
      kind: 'flights',
      displayName: 'Fake',
      isMock: false,
      answersByMonth: true,
      rateLimitPerMinute: 600,
    },
    async checkHealth() {
      throw new Error('not used');
    },
    async searchFlights(query: FlightSearchQuery) {
      calls.push(query);
      if (options.fail) return err(new AppError('PROVIDER_UNAVAILABLE', 'down'));

      const month = query.departureDate.slice(0, 7);
      const items: FlightOffer[] = [];
      for (let day = 1; day <= 28; day += 1) {
        if (day === 5 || day === 6) continue;
        const date = `${month}-${String(day).padStart(2, '0')}`;
        items.push(offer(date, 3, 10000 + day * 100), offer(date, 3, 20000 + day));
      }
      // The 30th flies, and comes home next month: only the second question finds it.
      if (query.returnDate.slice(0, 7) !== month) items.push(offer(`${month}-30`, 5, 9000));

      return ok({ items, nextCursor: null });
    },
  } as unknown as FlightProvider;

  return { provider, calls };
}

function setup(vendor = fakeVendor()) {
  const store = new MemoryCacheStore({ now: () => NOW });
  const deps = { flights: vendor.provider, store, pool: createLimiterPool(2), now: () => NOW };
  const query = {
    origin: 'VIE',
    destinations: ['AYT'],
    month: '2026-12',
    currency: 'EUR',
  };

  return { ...vendor, store, deps, query };
}

describe('loadMonthDayPrices', () => {
  it('keeps the cheapest fare per day and leaves a day with no flight out', async () => {
    const { deps, query } = setup();
    const result = await loadMonthDayPrices(query, deps);

    expect(result.reason).toBeNull();
    expect(result.days.get('2026-12-10')?.price).toEqual(money(11000, 'EUR'));
    expect(result.days.get('2026-12-10')?.returnDate).toBe('2026-12-13');
    expect(result.days.has('2026-12-05')).toBe(false);
    expect(result.days.has('2026-12-06')).toBe(false);
    expect(result.days.size).toBe(27);
  });

  it('finds a departure whose return is in the next month', async () => {
    const { deps, query } = setup();
    const result = await loadMonthDayPrices(query, deps);

    expect(result.days.get('2026-12-30')?.returnDate).toBe('2027-01-04');
  });

  it('two months are two cache entries, and a second read makes no call', async () => {
    const { deps, query, calls } = setup();

    await loadMonthDayPrices(query, deps);
    await loadMonthDayPrices({ ...query, month: '2027-01' }, deps);
    const made = calls.length;
    // Two questions per month: the vendor filters returns by month too.
    expect(made).toBe(4);

    const again = await loadMonthDayPrices(query, deps);
    const paged = await loadMonthDayPrices({ ...query, month: '2027-01' }, deps);

    expect(calls.length).toBe(made);
    expect(again.days.size).toBeGreaterThan(0);
    expect(paged.days.size).toBeGreaterThan(0);
  });

  it('a stale entry is served at once and refreshed, not waited for', async () => {
    const { deps, query, calls } = setup();
    await loadMonthDayPrices(query, deps);
    const made = calls.length;

    const later = { ...deps, now: () => NOW + 2 * 60 * 60_000 };
    const result = await loadMonthDayPrices(query, later);

    expect(result.days.size).toBe(27);
    // The refresh runs behind the answer; give it a turn.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls.length).toBeGreaterThan(made);
  });

  it('drops days before today', async () => {
    const { deps, query } = setup();
    const result = await loadMonthDayPrices(query, { ...deps, today: '2026-12-20' });

    expect(result.days.has('2026-12-19')).toBe(false);
    expect(result.days.has('2026-12-20')).toBe(true);
  });

  it('a failing vendor gives no prices and a reason, and is not remembered', async () => {
    const failing = setup(fakeVendor({ fail: true }));
    const result = await loadMonthDayPrices(failing.query, failing.deps);

    expect(result.days.size).toBe(0);
    expect(result.reason).toMatch(/could not be loaded/);

    const before = failing.calls.length;
    await loadMonthDayPrices(failing.query, failing.deps);
    expect(failing.calls.length).toBeGreaterThan(before);
  });

  it('refuses a malformed month and an empty destination list without a call', async () => {
    const { deps, query, calls } = setup();

    expect((await loadMonthDayPrices({ ...query, month: '2026-13' }, deps)).days.size).toBe(0);
    expect((await loadMonthDayPrices({ ...query, destinations: [] }, deps)).reason).not.toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('respects the stay bounds', async () => {
    const { deps, query } = setup();
    const result = await loadMonthDayPrices({ ...query, minNights: 4, maxNights: 14 }, deps);

    // Every fixture fare is three nights except the 30th, which is five.
    expect([...result.days.keys()]).toEqual(['2026-12-30']);
  });
});

describe('the mock provider, which cannot answer by month', () => {
  it('prices every day of a month, one exact pair at a time', async () => {
    const store = new MemoryCacheStore({ now: () => NOW });
    const result = await loadMonthDayPrices(
      { origin: 'VIE', destinations: ['AYT'], month: '2027-02', currency: 'EUR' },
      { flights: createMockFlightProvider(), store, pool: createLimiterPool(4), now: () => NOW },
    );

    // February 2027 has 28 days, and the mock has a flight on every one.
    expect(result.days.size).toBe(28);
    expect(result.days.get('2027-02-28')?.returnDate).toBe('2027-03-04');
  });
});
