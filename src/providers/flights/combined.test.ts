import { describe, expect, it, vi } from 'vitest';
import { fixedRates } from '@/core/fx';
import { money } from '@/core/money';
import type { FlightLeg, FlightOffer } from '@/core/trip/types';
import { AppError } from '@/lib/errors';
import { createLimiterPool } from '@/lib/concurrency';
import { err, ok } from '@/lib/result';
import type { FlightProvider, FlightSearchQuery } from '../types';
import {
  CombinedFlightProvider,
  combineFlightOffers,
  sameItinerary,
  type CombinedSearchReport,
} from './combined';

const query: FlightSearchQuery = {
  origins: ['VIE'],
  destinations: ['FCO'],
  departureDate: '2026-12-07',
  returnDate: '2026-12-12',
  passengers: 1,
  currency: 'EUR',
};

function leg(
  from: string,
  to: string,
  departsAt: string,
  arrivesAt: string | null,
  via: string[] = [],
): FlightLeg {
  const stops = [from, ...via, to];
  return {
    segments: stops.slice(1).map((destination, index) => ({
      origin: stops[index]!,
      destination,
      departsAt,
      arrivesAt: index === stops.length - 2 ? arrivesAt : null,
      carrier: 'XX',
      flightNumber: 'XX1',
    })),
    durationMinutes: 110,
    cabinBaggageIncluded: null,
    checkedBaggageIncluded: null,
    selfTransfer: null,
  };
}

function offer(
  providerId: string,
  euros: number,
  extra: Partial<{
    out: FlightLeg;
    back: FlightLeg;
    currency: string;
    id: string;
    ticketing: 'two_one_way';
  }> = {},
): FlightOffer {
  return {
    id: extra.id ?? `${providerId}:${euros}`,
    providerId,
    outbound: extra.out ?? leg('VIE', 'FCO', '2026-12-07T16:45', '2026-12-07T18:35'),
    inbound: extra.back ?? leg('FCO', 'VIE', '2026-12-12T19:10', '2026-12-12T21:00'),
    price: money(euros * 100, extra.currency ?? 'EUR'),
    observedAt: '2026-11-16T12:00:00Z',
    expiresAt: null,
    ...(extra.ticketing ? { ticketing: extra.ticketing } : {}),
  };
}

describe('combineFlightOffers: same itinerary', () => {
  it('keeps the cheaper price and records both providers', () => {
    const { offers, dropped } = combineFlightOffers(
      [
        { providerId: 'aviasales', offers: [offer('aviasales', 120)] },
        { providerId: 'google-flights', offers: [offer('google-flights', 99)] },
      ],
      { currency: 'EUR' },
    );

    expect(offers).toHaveLength(1);
    expect(offers[0]!.offer.price.amount).toBe(9900);
    expect(offers[0]!.offer.providerId).toBe('google-flights');
    // In the order the sources were given, not the order they won in.
    expect(offers[0]!.reportedBy).toEqual(['aviasales', 'google-flights']);
    expect(dropped).toEqual([
      {
        providerId: 'aviasales',
        offerId: 'aviasales:120',
        reason: { kind: 'duplicate', keptProviderId: 'google-flights' },
      },
    ]);
  });

  it('matches departures exactly at the 5 minute limit, not one minute past it', () => {
    const base = offer('a', 100);
    const within = offer('b', 100, {
      out: leg('VIE', 'FCO', '2026-12-07T16:50', '2026-12-07T18:35'),
    });
    const past = offer('c', 100, {
      out: leg('VIE', 'FCO', '2026-12-07T16:51', '2026-12-07T18:35'),
    });

    expect(sameItinerary(base, within, 5)).toBe(true);
    expect(sameItinerary(base, past, 5)).toBe(false);
    expect(
      sameItinerary(
        base,
        offer('d', 100, {
          out: leg('VIE', 'FCO', '2026-12-07T16:40', '2026-12-07T18:35'),
        }),
        5,
      ),
    ).toBe(true);
  });

  it('compares across midnight on the calendar, not the clock', () => {
    const late = offer('a', 100, { out: leg('VIE', 'FCO', '2026-12-07T23:58', null) });
    const just = offer('b', 100, { out: leg('VIE', 'FCO', '2026-12-08T00:02', null) });
    const far = offer('c', 100, { out: leg('VIE', 'FCO', '2026-12-08T23:58', null) });

    expect(sameItinerary(late, just, 5)).toBe(true);
    expect(sameItinerary(late, far, 5)).toBe(false);
  });

  it('does not let an unknown arrival contradict a known one, but does let a known one', () => {
    const unknown = offer('a', 100, { out: leg('VIE', 'FCO', '2026-12-07T16:45', null) });
    const known = offer('b', 100);
    const different = offer('c', 100, {
      out: leg('VIE', 'FCO', '2026-12-07T16:45', '2026-12-07T19:35'),
    });

    expect(sameItinerary(unknown, known, 5)).toBe(true);
    expect(sameItinerary(known, different, 5)).toBe(false);
  });

  it('treats a different airport, a different stop count or a different return as different', () => {
    const base = offer('a', 100);
    expect(
      sameItinerary(base, offer('b', 100, { out: leg('VIE', 'CIA', '2026-12-07T16:45', null) }), 5),
    ).toBe(false);
    expect(
      sameItinerary(
        base,
        offer('b', 100, { out: leg('VIE', 'FCO', '2026-12-07T16:45', null, ['MUC']) }),
        5,
      ),
    ).toBe(false);
    expect(
      sameItinerary(
        base,
        offer('b', 100, { back: leg('FCO', 'VIE', '2026-12-12T07:30', null) }),
        5,
      ),
    ).toBe(false);
  });

  it('at an equal price prefers one return ticket over two one-way tickets', () => {
    const { offers } = combineFlightOffers(
      [
        {
          providerId: 'google-flights',
          offers: [offer('google-flights', 100, { ticketing: 'two_one_way' })],
        },
        { providerId: 'aviasales', offers: [offer('aviasales', 100)] },
      ],
      { currency: 'EUR' },
    );

    expect(offers).toHaveLength(1);
    expect(offers[0]!.offer.providerId).toBe('aviasales');
    expect(offers[0]!.reportedBy).toEqual(['google-flights', 'aviasales']);
  });

  it('keeps distinct itineraries and sorts them by price', () => {
    const evening = offer('a', 150);
    const morning = offer('b', 80, {
      out: leg('VIE', 'FCO', '2026-12-07T06:55', '2026-12-07T08:40'),
    });
    const { offers } = combineFlightOffers(
      [
        { providerId: 'a', offers: [evening] },
        { providerId: 'b', offers: [morning] },
      ],
      { currency: 'EUR' },
    );

    expect(offers.map((entry) => entry.offer.price.amount)).toEqual([8000, 15000]);
  });

  it('merges duplicates within one source too, and an empty input gives nothing', () => {
    const { offers } = combineFlightOffers(
      [
        {
          providerId: 'a',
          offers: [offer('a', 100, { id: 'one' }), offer('a', 110, { id: 'two' })],
        },
      ],
      { currency: 'EUR' },
    );
    expect(offers).toHaveLength(1);
    expect(combineFlightOffers([], { currency: 'EUR' })).toEqual({ offers: [], dropped: [] });
  });
});

describe('combineFlightOffers: currencies are never mixed', () => {
  const usd = offer('google-flights', 100, { currency: 'USD' });
  const rates = fixedRates([
    { from: 'USD', to: 'EUR', rate: 0.9, observedAt: '2026-11-16T00:00:00Z' },
  ]);

  it('converts through the rate source and rounds once', () => {
    const { offers } = combineFlightOffers([{ providerId: 'google-flights', offers: [usd] }], {
      currency: 'EUR',
      rates,
    });

    expect(offers[0]!.offer.price).toEqual({ amount: 9000, currency: 'EUR' });
  });

  it('drops with a named reason when there is no rate for the pair', () => {
    const { offers, dropped } = combineFlightOffers(
      [{ providerId: 'google-flights', offers: [usd] }],
      { currency: 'GBP', rates },
    );

    expect(offers).toEqual([]);
    expect(dropped[0]!.reason).toEqual({ kind: 'no_rate', from: 'USD', to: 'GBP' });
  });

  it('drops with a named reason when no rate source was given at all', () => {
    const { offers, dropped } = combineFlightOffers(
      [{ providerId: 'google-flights', offers: [usd, offer('google-flights', 90)] }],
      { currency: 'EUR' },
    );

    expect(offers).toHaveLength(1);
    expect(dropped[0]!.reason).toEqual({ kind: 'currency_mismatch', from: 'USD', to: 'EUR' });
  });
});

function fake(
  id: string,
  result: () => ReturnType<FlightProvider['searchFlights']>,
  rateLimitPerMinute: number | null = null,
): FlightProvider & { searchFlights: ReturnType<typeof vi.fn> } {
  return {
    metadata: {
      id,
      kind: 'flights',
      displayName: id,
      isMock: false,
      mode: 'indicative',
      rateLimitPerMinute,
    },
    checkHealth: async () => ({
      status: 'healthy',
      checkedAt: '2026-11-16T12:00:00Z',
      latencyMs: null,
    }),
    searchFlights: vi.fn(result),
  };
}

const page = (...items: FlightOffer[]) => Promise.resolve(ok({ items, nextCursor: null }));

describe('CombinedFlightProvider', () => {
  it('merges two sources and reports what each did', async () => {
    const reports: CombinedSearchReport[] = [];
    const combined = new CombinedFlightProvider({
      providers: [
        fake('aviasales', () =>
          page(
            offer('aviasales', 120),
            offer('aviasales', 300, {
              out: leg('VIE', 'FCO', '2026-12-07T09:00', null),
            }),
          ),
        ),
        fake('google-flights', () => page(offer('google-flights', 99))),
      ],
      limiters: createLimiterPool(4),
      onReport: (report) => reports.push(report),
    });

    const result = await combined.searchFlights(query);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.items.map((o) => o.price.amount)).toEqual([9900, 30000]);
    expect(reports[0]!.sources).toEqual([
      { providerId: 'aviasales', calls: 1, offers: 2, failures: 0, error: null },
      { providerId: 'google-flights', calls: 1, offers: 1, failures: 0, error: null },
    ]);
    expect(reports[0]!.dropped).toHaveLength(1);
    expect(combined.metadata.id).toBe('aviasales+google-flights');
    expect(combined.metadata.mode).toBe('indicative');
  });

  it('degrades when one source fails: the other still answers', async () => {
    const combined = new CombinedFlightProvider({
      providers: [
        fake('aviasales', () => page(offer('aviasales', 120))),
        fake('google-flights', () =>
          Promise.resolve(err(new AppError('PROVIDER_UNAVAILABLE', 'blocked by Google'))),
        ),
      ],
      limiters: createLimiterPool(4),
    });

    const detailed = await combined.searchDetailed(query);
    expect(detailed.ok).toBe(true);
    if (!detailed.ok) return;
    expect(detailed.value.offers).toHaveLength(1);
    expect(detailed.value.report.sources[1]).toEqual({
      providerId: 'google-flights',
      calls: 1,
      offers: 0,
      failures: 1,
      error: 'blocked by Google',
    });
  });

  it('survives a source that throws instead of returning a Result', async () => {
    const combined = new CombinedFlightProvider({
      providers: [
        fake('aviasales', () => page(offer('aviasales', 120))),
        fake('google-flights', () => Promise.reject(new Error('boom'))),
      ],
      limiters: createLimiterPool(4),
    });

    const result = await combined.searchFlights(query);
    expect(result.ok && result.value.items).toHaveLength(1);
  });

  it('fails only when every source fails, naming each cause', async () => {
    const down = (message: string) => () =>
      Promise.resolve(err(new AppError('PROVIDER_UNAVAILABLE', message)));
    const reports: CombinedSearchReport[] = [];
    const combined = new CombinedFlightProvider({
      providers: [fake('aviasales', down('quota')), fake('google-flights', down('blocked'))],
      limiters: createLimiterPool(4),
      onReport: (report) => reports.push(report),
    });

    const result = await combined.searchFlights(query);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('aviasales: quota');
    expect(result.error.message).toContain('google-flights: blocked');
    expect(reports[0]!.sources.every((source) => source.failures === 1)).toBe(true);
  });

  it('an empty answer from one source is not a failure', async () => {
    const combined = new CombinedFlightProvider({
      providers: [
        fake('aviasales', () => page()),
        fake('google-flights', () => page(offer('google-flights', 99))),
      ],
      limiters: createLimiterPool(4),
    });
    const detailed = await combined.searchDetailed(query);
    expect(detailed.ok && detailed.value.report.sources[0]!.failures).toBe(0);
  });

  it('holds each source to its own limiter: a low-rate source never runs two at once', async () => {
    let running = 0;
    let peak = 0;
    const slow = fake(
      'google-flights',
      async () => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 5));
        running -= 1;
        return ok({ items: [offer('google-flights', 99)], nextCursor: null });
      },
      10,
    );
    const pool = createLimiterPool(4);
    const combined = new CombinedFlightProvider({
      providers: [fake('aviasales', () => page(offer('aviasales', 120)), 600), slow],
      limiters: pool,
    });

    await Promise.all(Array.from({ length: 6 }, () => combined.searchFlights(query)));

    expect(peak).toBe(1);
    expect(pool.limiters.get('google-flights')!.limit).toBe(1);
    expect(pool.limiters.get('google-flights')!.peakInFlight).toBe(1);
    // The fast vendor was not dragged down to the slow one's bound.
    expect(pool.limiters.get('aviasales')!.limit).toBeGreaterThan(1);
  });

  it('never holds one source waiting on another: a slow source does not delay the fast one', async () => {
    const order: string[] = [];
    const combined = new CombinedFlightProvider({
      providers: [
        fake(
          'google-flights',
          async () => {
            await new Promise((resolve) => setTimeout(resolve, 20));
            order.push('google-flights');
            return ok({ items: [], nextCursor: null });
          },
          10,
        ),
        fake(
          'aviasales',
          async () => {
            order.push('aviasales');
            return ok({ items: [], nextCursor: null });
          },
          600,
        ),
      ],
      limiters: createLimiterPool(4),
    });
    await combined.searchFlights(query);
    expect(order).toEqual(['aviasales', 'google-flights']);
  });

  it('needs at least one source and reports the weakest mode', () => {
    expect(
      () => new CombinedFlightProvider({ providers: [], limiters: createLimiterPool(1) }),
    ).toThrow(/at least one source/);
    const mock = fake('mock', () => page());
    (mock.metadata as { mode: string }).mode = 'mock';
    const combined = new CombinedFlightProvider({
      providers: [fake('aviasales', () => page()), mock],
      limiters: createLimiterPool(1),
    });
    expect(combined.metadata.mode).toBe('mock');
  });
});
