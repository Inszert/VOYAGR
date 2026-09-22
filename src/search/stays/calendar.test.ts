import { describe, expect, it } from 'vitest';
import { createMockStayProvider } from '@/providers/stays/mock';
import type { StayQuery } from '@/core/stay/types';
import { candidateWindows, exploreStayDates } from './calendar';

/**
 * Exploring dates without a provider calendar.
 *
 * The provider interface has no calendar method on purpose - almost no
 * accommodation vendor has one - so this is built from repeated exact-date
 * searches. These assert that it stays honest about which dates were
 * actually priced.
 */

const query: StayQuery = {
  destination: { code: 'BCN', name: 'Barcelona', position: null, radiusKm: null },
  checkIn: '2026-06-10',
  checkOut: '2026-06-14',
  occupancy: { adults: 2, children: 0, rooms: 1 },
  currency: 'EUR',
};

describe('candidateWindows', () => {
  it('shifts around the selected check-in, keeping the length', () => {
    const windows = candidateWindows(query, { shiftDays: 2 });

    expect(windows).toHaveLength(5);
    expect(windows[0]).toMatchObject({ checkIn: '2026-06-08', checkOut: '2026-06-12', nights: 4 });
    expect(windows.at(-1)).toMatchObject({ checkIn: '2026-06-12', checkOut: '2026-06-16' });
  });

  it('can try other stay lengths too', () => {
    const windows = candidateWindows(query, { shiftDays: 1, nightOptions: [3, 4] });

    expect(windows.map((w) => w.nights)).toEqual([3, 4, 3, 4, 3, 4]);
  });

  it('caps how many windows it will price', () => {
    // Every window is a full fan-out, so the count multiplies into calls and
    // into somebody's bill.
    expect(candidateWindows(query, { shiftDays: 30, maxWindows: 6 })).toHaveLength(6);
  });
});

describe('exploreStayDates', () => {
  it('prices every window and marks the selected one', async () => {
    const prices = await exploreStayDates([createMockStayProvider()], query, { shiftDays: 2 });

    expect(prices).toHaveLength(5);

    const selected = prices.find((p) => p.selected);
    expect(selected?.checkIn).toBe('2026-06-10');
    expect(selected?.differenceFromSelected?.amount).toBe(0);
  });

  it('reports each window against the selected one', async () => {
    const prices = await exploreStayDates([createMockStayProvider()], query, { shiftDays: 2 });

    for (const price of prices) {
      expect(price.total).not.toBeNull();
      expect(price.perNight).not.toBeNull();
      expect(price.providerId).toBe('mock-stays');
      // A difference and a percentage, both measured from where the user is.
      expect(price.differenceFromSelected).not.toBeNull();
      expect(price.fractionFromSelected).not.toBeNull();
    }
  });

  it('marks exactly the cheapest window', async () => {
    const prices = await exploreStayDates([createMockStayProvider()], query, { shiftDays: 3 });
    const cheapest = prices.filter((p) => p.cheapest);

    expect(cheapest.length).toBeGreaterThanOrEqual(1);

    const lowest = Math.min(...prices.map((p) => p.total?.amount ?? Infinity));
    for (const price of cheapest) expect(price.total?.amount).toBe(lowest);
  });

  it('keeps a window that returned nothing, rather than hiding the date', async () => {
    // "We looked and there was nothing" and "we never looked" are different
    // answers, and hiding the first tells the user the date does not exist.
    const empty = {
      ...createMockStayProvider(),
      searchStays: async () => ({ ok: true as const, value: [] }),
    };

    const prices = await exploreStayDates([empty], query, { shiftDays: 1 });

    expect(prices).toHaveLength(3);
    for (const price of prices) {
      expect(price.total).toBeNull();
      expect(price.providerId).toBeNull();
    }
  });
});
