import { describe, expect, it } from 'vitest';
import { isOk, unwrap } from '@/lib/result';
import type { ProviderPage } from './types';

/** The items of a page, for the many assertions that only care about those. */
function pageOf<T>(result: Parameters<typeof unwrap<ProviderPage<T>, Error>>[0]): readonly T[] {
  return unwrap(result).items;
}
import { createMockFlightProvider } from './flights/mock';
import { createMockHotelProvider } from './hotels/mock';
import { createMockWeatherProvider } from './weather/mock';
import { createMockTransferProvider } from './transfers/mock';
import { createMockPlacesProvider } from './places/mock';

/**
 * Mock adapter contract tests.
 *
 * These assert the properties every adapter must hold - determinism, honouring
 * its own query parameters, never throwing on a health check - rather than the
 * specific fixture values, which are free to change.
 */

const flightQuery = {
  origins: ['VIE'],
  destinations: ['AYT'],
  departureDate: '2026-06-10',
  returnDate: '2026-06-15',
  passengers: 2,
  currency: 'EUR',
} as const;

describe('mock flight provider', () => {
  const provider = createMockFlightProvider();

  it('returns offers for a valid query', async () => {
    const result = await provider.searchFlights(flightQuery);

    expect(isOk(result)).toBe(true);
    expect(unwrap(result).items.length).toBeGreaterThan(0);
  });

  it('is deterministic across calls', async () => {
    // Fixtures that shift between runs make every downstream test flaky.
    const first = pageOf(await provider.searchFlights(flightQuery));
    const second = pageOf(await provider.searchFlights(flightQuery));

    expect(first).toEqual(second);
  });

  it('varies with the query', async () => {
    const vienna = pageOf(await provider.searchFlights(flightQuery));
    const other = pageOf(await provider.searchFlights({ ...flightQuery, destinations: ['CHQ'] }));

    expect(vienna[0]?.price.amount).not.toBe(other[0]?.price.amount);
  });

  it('prices for the whole party', async () => {
    const forTwo = pageOf(await provider.searchFlights(flightQuery));
    const forOne = pageOf(await provider.searchFlights({ ...flightQuery, passengers: 1 }));

    expect(forTwo[0]!.price.amount).toBeGreaterThan(forOne[0]!.price.amount);
  });

  it('honours the direct-only flag', async () => {
    const result = pageOf(await provider.searchFlights({ ...flightQuery, directOnly: true }));

    for (const offer of result) {
      expect(offer.outbound.segments).toHaveLength(1);
      expect(offer.inbound.segments).toHaveLength(1);
    }
  });

  it('respects maxResults', async () => {
    const result = pageOf(await provider.searchFlights({ ...flightQuery, maxResults: 2 }));
    expect(result.length).toBeLessThanOrEqual(2);
  });

  it('returns offers sorted by price', async () => {
    const result = pageOf(await provider.searchFlights(flightQuery));
    const prices = result.map((offer) => offer.price.amount);

    expect([...prices].sort((a, b) => a - b)).toEqual(prices);
  });

  it('stamps every offer with a provider and an observation time', async () => {
    for (const offer of pageOf(await provider.searchFlights(flightQuery))) {
      expect(offer.providerId).toBe('mock-flights');
      expect(offer.observedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });

  it('reports health without throwing', async () => {
    expect((await provider.checkHealth()).status).toBe('healthy');
  });
});

const hotelQuery = {
  destination: 'AYT',
  checkIn: '2026-06-10',
  checkOut: '2026-06-15',
  guests: 2,
  currency: 'EUR',
} as const;

describe('mock hotel provider', () => {
  const provider = createMockHotelProvider();

  it('is deterministic', async () => {
    const first = pageOf(await provider.searchHotels(hotelQuery));
    const second = pageOf(await provider.searchHotels(hotelQuery));

    expect(first).toEqual(second);
  });

  it('scales the total with the length of stay', async () => {
    const short = pageOf(await provider.searchHotels({ ...hotelQuery, checkOut: '2026-06-12' }));
    const long = pageOf(await provider.searchHotels(hotelQuery));

    expect(long[0]!.totalPrice.amount).toBeGreaterThan(short[0]!.totalPrice.amount);
  });

  it('returns nothing for an inverted date range', async () => {
    const result = pageOf(
      await provider.searchHotels({ ...hotelQuery, checkIn: '2026-06-15', checkOut: '2026-06-10' }),
    );

    expect(result).toHaveLength(0);
  });

  it('honours the minimum review score filter', async () => {
    const result = pageOf(await provider.searchHotels({ ...hotelQuery, minReviewScore: 8.5 }));

    for (const offer of result) {
      expect(offer.reviewScore).toBeGreaterThanOrEqual(8.5);
    }
  });

  it('honours the free-cancellation filter', async () => {
    const result = unwrap(
      await provider.searchHotels({ ...hotelQuery, freeCancellationOnly: true }),
    );

    for (const offer of result.items) {
      expect(offer.freeCancellation).toBe(true);
    }
  });

  it('omits beach distance for a landlocked destination', async () => {
    const result = pageOf(await provider.searchHotels({ ...hotelQuery, destination: 'TBS' }));

    for (const offer of result) {
      expect(offer.distanceToBeachMetres).toBeNull();
    }
  });
});

describe('mock weather provider', () => {
  const provider = createMockWeatherProvider();

  it('returns one outlook per day, inclusive of both ends', async () => {
    const result = unwrap(
      await provider.getOutlook({
        destination: 'AYT',
        startDate: '2026-06-10',
        endDate: '2026-06-14',
      }),
    );

    expect(result).toHaveLength(5);
    expect(result[0]!.date).toBe('2026-06-10');
    expect(result.at(-1)!.date).toBe('2026-06-14');
  });

  it('lowers confidence the further out the date is', async () => {
    // Section 13: a long-range outlook is climatology, and must say so.
    const near = unwrap(
      await provider.getOutlook({
        destination: 'AYT',
        startDate: '2026-01-16',
        endDate: '2026-01-16',
      }),
    );
    const far = unwrap(
      await provider.getOutlook({
        destination: 'AYT',
        startDate: '2026-08-16',
        endDate: '2026-08-16',
      }),
    );

    expect(near[0]!.confidence).toBeGreaterThan(far[0]!.confidence);
  });

  it('keeps the minimum below the maximum', async () => {
    const result = unwrap(
      await provider.getOutlook({
        destination: 'CHQ',
        startDate: '2026-07-01',
        endDate: '2026-07-07',
      }),
    );

    for (const day of result) {
      expect(day.temperatureMinC).toBeLessThan(day.temperatureMaxC);
      expect(day.precipitationProbability).toBeGreaterThanOrEqual(0);
      expect(day.precipitationProbability).toBeLessThanOrEqual(1);
    }
  });

  it('follows the seasonal pattern of the destination', async () => {
    const january = unwrap(
      await provider.getOutlook({
        destination: 'AYT',
        startDate: '2026-01-10',
        endDate: '2026-01-10',
      }),
    );
    const july = unwrap(
      await provider.getOutlook({
        destination: 'AYT',
        startDate: '2026-07-10',
        endDate: '2026-07-10',
      }),
    );

    expect(july[0]!.temperatureMaxC).toBeGreaterThan(january[0]!.temperatureMaxC);
  });

  it('returns nothing for an inverted range', async () => {
    const result = unwrap(
      await provider.getOutlook({
        destination: 'AYT',
        startDate: '2026-06-15',
        endDate: '2026-06-10',
      }),
    );

    expect(result).toHaveLength(0);
  });
});

describe('mock transfer provider', () => {
  const provider = createMockTransferProvider();

  it('offers several modes, cheapest first', async () => {
    const result = unwrap(
      await provider.searchTransfers({
        airport: 'AYT',
        destinationName: 'Antalya',
        passengers: 2,
        currency: 'EUR',
      }),
    );

    expect(result.length).toBeGreaterThan(1);

    const prices = result.map((offer) => offer.pricePerDirection.amount);
    expect([...prices].sort((a, b) => a - b)).toEqual(prices);
  });

  it('prices per direction, not per trip', async () => {
    const result = unwrap(
      await provider.searchTransfers({
        airport: 'AYT',
        destinationName: 'Antalya',
        passengers: 2,
        currency: 'EUR',
      }),
    );

    // The cost engine doubles this; the adapter must not pre-double it.
    for (const offer of result) {
      expect(offer.pricePerDirection.amount).toBeGreaterThan(0);
      expect(offer.durationMinutes).toBeGreaterThan(0);
    }
  });
});

describe('mock places provider', () => {
  const provider = createMockPlacesProvider();

  it('returns places in the requested categories', async () => {
    const result = unwrap(
      await provider.searchPlaces({ destination: 'AYT', categories: ['restaurant', 'beach'] }),
    );

    expect(result.length).toBeGreaterThan(0);
    for (const place of result) {
      expect(['restaurant', 'beach']).toContain(place.category);
    }
  });

  it('returns no beaches for a landlocked destination', async () => {
    const result = unwrap(
      await provider.searchPlaces({ destination: 'TBS', categories: ['beach'] }),
    );

    expect(result).toHaveLength(0);
  });

  it('respects maxResults', async () => {
    const result = unwrap(
      await provider.searchPlaces({
        destination: 'AYT',
        categories: ['restaurant', 'cafe', 'activity'],
        maxResults: 5,
      }),
    );

    expect(result.length).toBeLessThanOrEqual(5);
  });
});

describe('pagination', () => {
  const provider = createMockFlightProvider();

  it('returns a cursor while more results remain', async () => {
    const first = unwrap(await provider.searchFlights({ ...flightQuery, maxResults: 1 }));

    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toBeTruthy();
  });

  it('continues from the cursor without repeating an offer', async () => {
    const first = unwrap(await provider.searchFlights({ ...flightQuery, maxResults: 1 }));
    const second = unwrap(
      await provider.searchFlights({ ...flightQuery, maxResults: 1, cursor: first.nextCursor! }),
    );

    expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
  });

  it('reports a null cursor on the last page', async () => {
    // How a caller knows to stop, and the only thing it may infer from a cursor.
    let cursor: string | undefined;
    let pages = 0;

    for (;;) {
      const page: { items: readonly unknown[]; nextCursor: string | null } = unwrap(
        await provider.searchFlights({
          ...flightQuery,
          maxResults: 1,
          ...(cursor ? { cursor } : {}),
        }),
      );

      pages += 1;
      if (!page.nextCursor || pages > 20) break;
      cursor = page.nextCursor;
    }

    expect(pages).toBeGreaterThan(1);
    expect(pages).toBeLessThanOrEqual(20);
  });

  it('is deterministic across paged calls', async () => {
    const a = unwrap(await provider.searchFlights({ ...flightQuery, maxResults: 2 }));
    const b = unwrap(await provider.searchFlights({ ...flightQuery, maxResults: 2 }));

    expect(a).toEqual(b);
  });

  it('ignores a cursor it did not issue rather than failing', async () => {
    const page = unwrap(await provider.searchFlights({ ...flightQuery, cursor: 'nonsense' }));
    expect(page.items.length).toBeGreaterThan(0);
  });
});
