import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { flightOfferSchema, googleFlightsRowSchema, validateOffers } from '../schema';
import type { FlightSearchQuery } from '../types';
import {
  FLIGHT_NUMBER_UNSTATED,
  GoogleFlightsProvider,
  googleFlightsSearchUrl,
  mapResponse,
  mapRow,
} from './google-flights';

/**
 * The Google Flights adapter, offline: the sidecar is a literal and `fetchImpl` is injected.
 *
 * The fixture is SYNTHETIC - Google served a consent page to the real library run, so no live
 * answer could be recorded (see its `_note`). It was produced by the sidecar's own
 * `flights_to_offers` from the library's real result classes, which makes the JSON shape true to
 * the sidecar and the numbers invented. These tests prove our handling, not Google's fares.
 */

const fixture = JSON.parse(
  readFileSync(join('tests', 'fixtures', 'providers', 'google-flights-vie-fco.json'), 'utf8'),
) as { outbound: Record<string, unknown>; inbound: Record<string, unknown> };

const json = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );

const query: FlightSearchQuery = {
  origins: ['VIE'],
  destinations: ['FCO'],
  departureDate: '2026-12-07',
  returnDate: '2026-12-12',
  passengers: 1,
  currency: 'EUR',
};

/** Answers by direction, like the real sidecar would, and keeps every request it saw. */
function sidecar(overrides: { outbound?: unknown; inbound?: unknown; status?: number } = {}) {
  const seen: { url: URL; headers: Record<string, string> }[] = [];
  const fetchImpl = vi.fn((url: string, init?: RequestInit) => {
    const parsed = new URL(url);
    seen.push({ url: parsed, headers: (init?.headers ?? {}) as Record<string, string> });
    const body =
      parsed.searchParams.get('origin') === 'VIE'
        ? (overrides.outbound ?? fixture.outbound)
        : (overrides.inbound ?? fixture.inbound);
    return json(body, overrides.status);
  });
  return { fetchImpl, seen };
}

const make = (fetchImpl: ReturnType<typeof sidecar>['fetchImpl'], key?: string) =>
  new GoogleFlightsProvider({
    baseUrl: 'http://127.0.0.1:8765/',
    ...(key ? { key } : {}),
    fetchImpl,
    now: () => new Date('2026-11-16T12:30:00Z'),
  });

describe('GoogleFlightsProvider.searchFlights', () => {
  it('pairs the cheapest single flights each way into return trips, cheapest first', async () => {
    const { fetchImpl } = sidecar();
    const result = await make(fetchImpl).searchFlights(query);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [cheapest] = result.value.items;
    // 54 out + 61 back, whole euros -> minor units, no float anywhere.
    expect(cheapest!.price).toEqual({ amount: 11500, currency: 'EUR' });
    expect(cheapest!.ticketing).toBe('two_one_way');
    expect(cheapest!.expiresAt).toBeNull();
    // 4 outbound x 3 inbound, all paired.
    expect(result.value.items).toHaveLength(12);
    const amounts = result.value.items.map((offer) => offer.price.amount);
    expect(amounts).toEqual([...amounts].sort((a, b) => a - b));
    expect(result.value.nextCursor).toBeNull();
  });

  it('produces offers the flight boundary accepts, with provenance of observation', async () => {
    const { fetchImpl } = sidecar();
    const result = await make(fetchImpl).searchFlights(query);
    if (!result.ok) throw result.error;

    const { accepted, rejected } = validateOffers(flightOfferSchema, result.value.items);
    expect(rejected).toEqual([]);
    expect(accepted).toHaveLength(12);
    // The sidecar's own fetch time, not "now": this is when Google was asked.
    expect(accepted[0]!.observedAt).toBe('2026-11-16T12:00:00Z');
  });

  it('maps a connection to itemised segments and a duration that includes the layover', async () => {
    const { fetchImpl } = sidecar();
    const result = await make(fetchImpl).searchFlights({ ...query, maxResults: 100 });
    if (!result.ok) throw result.error;

    const connecting = result.value.items.find((offer) => offer.outbound.segments.length === 2)!;
    expect(connecting.outbound.segments.map((hop) => `${hop.origin}-${hop.destination}`)).toEqual([
      'VIE-MUC',
      'MUC-FCO',
    ]);
    expect(connecting.outbound.durationMinutes).toBe(260);
    expect(connecting.outbound.segments[0]!.departsAt).toBe('2026-12-07T09:10');
    expect(connecting.outbound.segments[1]!.arrivesAt).toBe('2026-12-07T13:30');
  });

  it('says what it does not know: no flight number, no baggage, no ticketing', async () => {
    const { fetchImpl } = sidecar();
    const result = await make(fetchImpl).searchFlights(query);
    if (!result.ok) throw result.error;

    const leg = result.value.items[0]!.outbound;
    expect(leg.segments[0]!.flightNumber).toBe(FLIGHT_NUMBER_UNSTATED);
    expect(leg.segments[0]!.carrier).toBe('Ryanair');
    expect(leg.cabinBaggageIncluded).toBeNull();
    expect(leg.checkedBaggageIncluded).toBeNull();
    expect(leg.selfTransfer).toBeNull();
  });

  it('links to a Google Flights search for each direction, never to a booking', async () => {
    const { fetchImpl } = sidecar();
    const result = await make(fetchImpl).searchFlights(query);
    if (!result.ok) throw result.error;

    const trip = result.value.items[0]!;
    const out = new URL(trip.deepLink!);
    const back = new URL(trip.returnDeepLink!);
    expect(out.origin + out.pathname).toBe('https://www.google.com/travel/flights');
    expect(out.searchParams.get('q')).toBe('Flights from VIE to FCO on 2026-12-07 one way');
    expect(back.searchParams.get('q')).toBe('Flights from FCO to VIE on 2026-12-12 one way');
  });

  it('asks for one adult and multiplies the party out exactly', async () => {
    const { fetchImpl, seen } = sidecar();
    const result = await make(fetchImpl).searchFlights({ ...query, passengers: 3 });
    if (!result.ok) throw result.error;

    expect(seen.every((request) => request.url.searchParams.get('adults') === '1')).toBe(true);
    expect(result.value.items[0]!.price.amount).toBe(11500 * 3);
  });

  it('makes exactly two sidecar calls for a return, one per direction', async () => {
    const { fetchImpl, seen } = sidecar();
    await make(fetchImpl).searchFlights({ ...query, directOnly: true });

    expect(seen.map((request) => request.url.searchParams.get('origin'))).toEqual(['VIE', 'FCO']);
    expect(seen.map((request) => request.url.searchParams.get('date'))).toEqual([
      '2026-12-07',
      '2026-12-12',
    ]);
    expect(seen.every((request) => request.url.searchParams.get('max_stops') === '0')).toBe(true);
  });

  it('sends the key as a header only, never in the URL', async () => {
    const { fetchImpl, seen } = sidecar();
    await make(fetchImpl, 'shh-secret').searchFlights(query);

    expect(seen[0]!.headers['X-Voyagr-Sidecar-Key']).toBe('shh-secret');
    expect(seen[0]!.url.toString()).not.toContain('shh-secret');

    const open = sidecar();
    await make(open.fetchImpl).searchFlights(query);
    expect(open.seen[0]!.headers).not.toHaveProperty('X-Voyagr-Sidecar-Key');
  });

  it('honours maxResults', async () => {
    const { fetchImpl } = sidecar();
    const result = await make(fetchImpl).searchFlights({ ...query, maxResults: 2 });
    if (!result.ok) throw result.error;
    expect(result.value.items).toHaveLength(2);
  });

  it('keeps a same-day return (zero nights) as a valid pair', async () => {
    const { fetchImpl } = sidecar();
    const result = await make(fetchImpl).searchFlights({ ...query, returnDate: '2026-12-07' });
    expect(result.ok).toBe(true);
  });
});

describe('failures degrade, they never throw', () => {
  it('reports a consent wall as the provider being blocked', async () => {
    const blocked = vi.fn(() =>
      json({ error: { code: 'consent_wall', message: 'Google served its consent page' } }, 503),
    );
    const result = await make(blocked).searchFlights(query);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('PROVIDER_UNAVAILABLE');
    expect(result.error.message).toMatch(/blocking the scraper/);
    // One call is enough to know; the return leg is not attempted against a wall.
    expect(blocked).toHaveBeenCalledTimes(1);
  });

  it.each([
    [401, 'PROVIDER_ERROR'],
    [429, 'PROVIDER_UNAVAILABLE'],
    [500, 'PROVIDER_ERROR'],
    [504, 'PROVIDER_TIMEOUT'],
  ])('maps sidecar status %i to %s', async (status, code) => {
    const result = await make(vi.fn(() => json({ error: { code: 'x' } }, status))).searchFlights(
      query,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe(code);
  });

  it('fails the search when only one direction is available', async () => {
    const fetchImpl = vi.fn((url: string) =>
      new URL(url).searchParams.get('origin') === 'VIE'
        ? json(fixture.outbound)
        : json({ error: { code: 'rate_limited' } }, 429),
    );
    const result = await make(fetchImpl).searchFlights(query);
    expect(result.ok).toBe(false);
  });

  it('maps a network error and an abort to unavailable and timeout', async () => {
    const down = await make(
      vi.fn(() => Promise.reject(new TypeError('fetch failed'))),
    ).searchFlights(query);
    expect(!down.ok && down.error.code).toBe('PROVIDER_UNAVAILABLE');

    const slow = await make(
      vi.fn(() => Promise.reject(Object.assign(new Error('aborted'), { name: 'TimeoutError' }))),
    ).searchFlights(query);
    expect(!slow.ok && slow.error.code).toBe('PROVIDER_TIMEOUT');
  });

  it('rejects an unrecognised envelope instead of reading it', async () => {
    const result = await make(vi.fn(() => json({ hello: 'world' }))).searchFlights(query);
    expect(!result.ok && result.error.code).toBe('PROVIDER_ERROR');
  });

  it('rejects a fetched_at with no zone: an observation must be an instant', async () => {
    const naive = { ...fixture.outbound, fetched_at: '2026-11-16T12:00:00' };
    const result = await make(vi.fn(() => json(naive))).searchFlights(query);
    expect(result.ok).toBe(false);
  });

  it('refuses a search with no origin, no destination or no passengers', async () => {
    const provider = make(sidecar().fetchImpl);
    expect((await provider.searchFlights({ ...query, origins: [] })).ok).toBe(false);
    expect((await provider.searchFlights({ ...query, destinations: [] })).ok).toBe(false);
    const none = await provider.searchFlights({ ...query, passengers: 0 });
    expect(!none.ok && none.error.code).toBe('VALIDATION_ERROR');
  });

  it('refuses to build without a sidecar URL', () => {
    expect(() => new GoogleFlightsProvider({ baseUrl: '' })).toThrow(/GOOGLE_FLIGHTS_SIDECAR_URL/);
  });
});

describe('boundary schema and row mapping', () => {
  const context = {
    providerId: 'google-flights',
    origin: 'VIE',
    destination: 'FCO',
    observedAt: '2026-11-16T12:00:00Z',
    passengers: 1,
    deepLink: 'https://www.google.com/travel/flights?q=x',
  };
  const good = (fixture.outbound.offers as Record<string, unknown>[])[0]!;

  it('accepts every row of the fixture', () => {
    for (const row of [
      ...(fixture.outbound.offers as unknown[]),
      ...(fixture.inbound.offers as unknown[]),
    ]) {
      expect(googleFlightsRowSchema.safeParse(row).success).toBe(true);
    }
  });

  it('requires nullable facts to be present: a missing key is an adapter bug', () => {
    const { is_best: _isBest, ...withoutIsBest } = good;
    expect(googleFlightsRowSchema.safeParse(withoutIsBest).success).toBe(false);
    expect(googleFlightsRowSchema.safeParse({ ...good, is_best: null }).success).toBe(true);
  });

  it.each([
    ['a zoned departure', { departs_at: '2026-12-07T16:45:00Z' }],
    ['a negative stop count', { stops: -1 }],
    ['a zero duration', { duration_minutes: 0 }],
    ['a four-letter currency', { currency: 'EURO' }],
    ['no segments', { segments: [] }],
    ['a numeric price', { price: 54 }],
  ])('drops a row with %s', (_name, patch) => {
    expect(mapRow({ ...good, ...patch }, context)).toBe('malformed');
  });

  it('counts unpriced, unreadable and incomplete rows by reason', () => {
    expect(mapRow({ ...good, price: null }, context)).toBe('unpriced');
    expect(mapRow({ ...good, price: 'call us' }, context)).toBe('unreadable_price');
    expect(mapRow({ ...good, price: '€0' }, context)).toBe('unreadable_price');
    expect(mapRow({ ...good, duration_minutes: null }, context)).toBe('incomplete_journey');
    expect(mapRow({ ...good, stops: 1 }, context)).toBe('incomplete_journey');
    // Another airport than the one asked about is not this route.
    expect(mapRow(good, { ...context, destination: 'CIA' })).toBe('incomplete_journey');
  });

  it('refuses a price whose symbol contradicts the stated currency', () => {
    expect(mapRow({ ...good, price: '£54' }, context)).toBe('unreadable_price');
  });

  it('keeps the good rows of a page that holds a bad one', () => {
    const body = { ...fixture.outbound, offers: [good, { nonsense: true }, null] };
    const outcome = mapResponse(body, context)!;
    expect(outcome.fares).toHaveLength(1);
    expect(outcome.skipped.malformed).toBe(2);
  });

  it('uses the party size on the fare', () => {
    const fare = mapRow(good, { ...context, passengers: 4 });
    expect(typeof fare).toBe('object');
    if (typeof fare === 'object') expect(fare.price).toEqual({ amount: 5400 * 4, currency: 'EUR' });
  });

  it('builds search links without a booking claim', () => {
    expect(googleFlightsSearchUrl('VIE', 'FCO', '2026-12-07', '2026-12-12', 'eur')).toContain(
      'through+2026-12-12',
    );
  });
});

describe('metadata', () => {
  it('is an indicative, low-rate, non-mock source with the stable id', () => {
    const { metadata } = make(sidecar().fetchImpl);
    expect(metadata.id).toBe('google-flights');
    expect(metadata.mode).toBe('indicative');
    expect(metadata.isMock).toBe(false);
    expect(metadata.rateLimitPerMinute).toBeLessThanOrEqual(10);
  });

  it('reports health without a search', async () => {
    const up = await make(vi.fn(() => json({ status: 'ok' }))).checkHealth();
    expect(up.status).toBe('healthy');
    const down = await make(vi.fn(() => Promise.reject(new Error('refused')))).checkHealth();
    expect(down.status).toBe('unavailable');
  });
});
