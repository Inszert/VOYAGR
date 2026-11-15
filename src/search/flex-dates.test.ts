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
import { loadFlexDates } from './flex-dates';

const NOW = Date.parse('2026-11-14T12:00:00.000Z');

function offer(day: string, nights: number, amount: number): FlightOffer {
  return {
    id: `${day}-${nights}`,
    providerId: 'fake',
    outbound: { segments: [{ departsAt: `${day}T08:00` }] },
    inbound: { segments: [{ departsAt: `${addDays(day, nights)}T18:00` }] },
    price: money(amount, 'EUR'),
    observedAt: '2026-11-14T11:55:00.000Z',
    expiresAt: null,
  } as unknown as FlightOffer;
}

/** Five-night fares in December, 300 euro on the 10th and cheaper two days before it. */
function vendor(fail = false) {
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
    async searchFlights(query: FlightSearchQuery) {
      calls.push(query);
      if (fail) return err(new AppError('PROVIDER_ERROR', 'down'));

      const month = query.departureDate.slice(0, 7);
      const items = [7, 8, 10, 11, 31].map((day) => {
        const date = `${month}-${String(day).padStart(2, '0')}`;
        return offer(date, 5, day === 8 ? 21600 : 30000);
      });
      return ok({ items, nextCursor: null });
    },
  } as unknown as FlightProvider;

  return { provider, calls };
}

function setup(fail = false) {
  const v = vendor(fail);
  const store = new MemoryCacheStore({ now: () => NOW });
  const deps = { flights: v.provider, store, pool: createLimiterPool(2), now: () => NOW };
  const query = {
    origin: 'VIE',
    destination: 'AYT',
    departureDate: '2026-12-10',
    returnDate: '2026-12-15',
    currency: 'EUR',
    windowDays: 3,
  };

  return { ...v, store, deps, query };
}

describe('loadFlexDates', () => {
  it('prices the days that have a fare and leaves the rest unknown', async () => {
    const { deps, query } = setup();
    const result = await loadFlexDates(query, deps);
    const at = (offset: number) => result.options.find((o) => o.offset === offset)!;

    expect(result.options).toHaveLength(7);
    expect(at(-2).price).toEqual(money(21600, 'EUR'));
    expect(at(-2).saving).toEqual(money(8400, 'EUR'));
    expect(at(-1).price).toBeNull();
    expect(at(0).price).toEqual(money(30000, 'EUR'));
    expect(result.best?.option.offset).toBe(-2);
    expect(result.reason).toBeNull();
  });

  it('a window across a month end reads both months', async () => {
    const { deps, query, calls } = setup();
    const result = await loadFlexDates(
      { ...query, departureDate: '2026-12-30', returnDate: '2027-01-04' },
      deps,
    );

    // December and January, two questions each.
    expect(calls).toHaveLength(4);
    expect(result.options).toHaveLength(7);
  });

  it('makes no provider call when the month is already cached', async () => {
    const { deps, query, calls } = setup();

    // The calendar's own read for the same stay, made first.
    await loadMonthDayPrices(
      {
        origin: 'VIE',
        destinations: ['AYT'],
        month: '2026-12',
        currency: 'EUR',
        minNights: 5,
        maxNights: 5,
      },
      deps,
    );
    const made = calls.length;

    const result = await loadFlexDates(query, deps);

    expect(calls.length).toBe(made);
    expect(result.options.find((o) => o.offset === -2)!.price).not.toBeNull();
  });

  it('a failing provider gives every day unknown, with a reason, and does not throw', async () => {
    const { deps, query } = setup(true);
    const result = await loadFlexDates(query, deps);

    expect(result.options.every((o) => o.price === null)).toBe(true);
    expect(result.best).toBeNull();
    expect(result.ageMs).toBeNull();
    expect(result.reason).toMatch(/could not be loaded/);
  });

  it('prices an exact seven-night stay from a vendor that answers one pair at a time', async () => {
    const store = new MemoryCacheStore({ now: () => NOW });
    const result = await loadFlexDates(
      {
        origin: 'VIE',
        destination: 'AYT',
        departureDate: '2026-12-10',
        returnDate: '2026-12-17',
        currency: 'EUR',
        windowDays: 3,
      },
      {
        flights: createMockFlightProvider(),
        store,
        pool: createLimiterPool(4),
        now: () => NOW,
      },
    );

    // Every day is priced for the same seven nights, none invented.
    expect(result.options.some((o) => o.price !== null)).toBe(true);
    expect(result.options.every((o) => o.returnDate === addDays(o.departureDate, 7))).toBe(true);
  });

  it('a window of zero is just the chosen day', async () => {
    const { deps, query } = setup();

    expect((await loadFlexDates({ ...query, windowDays: 0 }, deps)).options).toHaveLength(1);
  });

  it('reports the age of the oldest price shown', async () => {
    const { deps, query } = setup();
    const result = await loadFlexDates(query, deps);

    expect(result.ageMs).toBe(5 * 60_000);
  });
});
