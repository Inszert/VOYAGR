import { describe, expect, it } from 'vitest';
import { flightOfferSchema, validateOffers } from '../schema';
import { loadCassette } from '../http/cassette';
import { AviasalesFlightProvider, mapOffer, observedFromLink, toLocalDateTime } from './aviasales';

/**
 * The Aviasales adapter, offline.
 *
 * No network, no credentials: every response here is a literal, and the
 * adapter's `fetchImpl` is injected. The literals below cover the edges a
 * real call cannot be made to produce on demand - a 429, a 500, a timeout,
 * a malformed row. The block at the bottom replays a genuine recorded
 * response, which is where the claims about shape, timezone and caching are
 * actually evidenced.
 */

const TOKEN = 'test-token-not-a-real-credential';

/** One direct round trip, in the documented shape. */
const direct = {
  origin: 'VIE',
  destination: 'AYT',
  departure_at: '2026-06-10T08:00:00+02:00',
  return_at: '2026-06-15T12:30:00+03:00',
  airline: 'PC',
  flight_number: 1234,
  price: 249,
  transfers: 0,
  return_transfers: 0,
  duration_to: 155,
  duration_back: 160,
  link: '/search/VIE1006AYT1',
};

const respond = (body: unknown, status = 200) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );

const providerWith = (body: unknown, status = 200) => {
  const seen: string[] = [];

  const provider = new AviasalesFlightProvider({
    token: TOKEN,
    partnerId: '123456',
    now: () => new Date('2026-06-01T09:00:00Z'),
    fetchImpl: (url) => {
      seen.push(url);
      return respond(body, status);
    },
  });

  return { provider, seen };
};

const query = {
  origins: ['VIE'],
  destinations: ['AYT'],
  departureDate: '2026-06-10',
  returnDate: '2026-06-15',
  passengers: 2,
  currency: 'EUR',
  maxResults: 10,
} as const;

describe('toLocalDateTime', () => {
  it('drops the offset to leave a wall clock', () => {
    // The domain refuses a flight time carrying a zone, so the offset has to
    // come off. Whether 08:00 is genuinely local at VIE is the one thing a
    // real response has to confirm.
    expect(toLocalDateTime('2026-06-10T08:00:00+02:00')).toBe('2026-06-10T08:00');
    expect(toLocalDateTime('2026-06-10T08:00:00Z')).toBe('2026-06-10T08:00');
  });

  it('returns null for anything that is not a timestamp', () => {
    expect(toLocalDateTime('soon')).toBeNull();
    expect(toLocalDateTime('')).toBeNull();
  });
});

describe('mapOffer', () => {
  const map = (raw: unknown) => mapOffer(raw, 'EUR', '2026-06-01T09:00:00Z', 'aviasales');

  it('maps a direct round trip into an offer the domain accepts', () => {
    const result = map(direct);

    expect('offer' in result).toBe(true);
    if (!('offer' in result)) return;

    // The real test: it passes the same boundary validation a live vendor's
    // response must, so the adapter cannot quietly emit a shape core rejects.
    expect(validateOffers(flightOfferSchema, [result.offer]).rejected).toEqual([]);
  });

  it('converts the price through fromMajor rather than as a float', () => {
    const result = map(direct);
    if (!('offer' in result)) throw new Error('expected an offer');

    // 249 whole euros is 24,900 minor units. A float multiplication here is
    // the classic money bug.
    expect(result.offer.price).toEqual({ amount: 24_900, currency: 'EUR' });
  });

  it('records what the vendor did not say as null, not as false', () => {
    const result = map(direct);
    if (!('offer' in result)) throw new Error('expected an offer');

    // This endpoint carries no baggage or ticketing information at all. A
    // `false` here would be a confident claim we never had grounds for, in
    // exactly the fields the No-Surprise check reads.
    expect(result.offer.outbound.cabinBaggageIncluded).toBeNull();
    expect(result.offer.outbound.checkedBaggageIncluded).toBeNull();
    expect(result.offer.outbound.selfTransfer).toBeNull();
  });

  it('refuses a connecting flight rather than inventing the connection', () => {
    // The response names the airline and the total duration but never the
    // connection airport or its times. A segment list filled in to cover that
    // gap would be a fabricated itinerary shown to a traveller.
    expect(map({ ...direct, transfers: 1 })).toEqual({ skipped: 'connecting' });
    expect(map({ ...direct, return_transfers: 2 })).toEqual({ skipped: 'connecting' });
  });

  it('refuses a price point missing a field the mapping depends on', () => {
    const { duration_to: _dropped, ...withoutDuration } = direct;

    expect(map(withoutDuration)).toEqual({ skipped: 'malformed' });
    expect(map({ ...direct, price: 'cheap' })).toEqual({ skipped: 'malformed' });
    expect(map(null)).toEqual({ skipped: 'malformed' });
  });

  it('refuses a timestamp it cannot read', () => {
    expect(map({ ...direct, departure_at: 'tomorrow' })).toEqual({ skipped: 'unparsable_time' });
  });

  it('carries the affiliate link through when the vendor sends one', () => {
    const result = map(direct);
    if (!('offer' in result)) throw new Error('expected an offer');

    expect(result.offer.deepLink).toContain('/search/VIE1006AYT1');
  });
});

describe('searchFlights', () => {
  it('sends the token and the marker, and asks only for direct flights', async () => {
    const { provider, seen } = providerWith({ success: true, currency: 'eur', data: [direct] });

    await provider.searchFlights(query);

    const url = new URL(seen[0]!);
    expect(url.searchParams.get('token')).toBe(TOKEN);
    expect(url.searchParams.get('marker')).toBe('123456');
    expect(url.searchParams.get('origin')).toBe('VIE');
    // Connecting results cannot be mapped, so there is no point paying for
    // them in the response budget.
    expect(url.searchParams.get('direct')).toBe('true');
  });

  it('returns offers that pass boundary validation', async () => {
    const { provider } = providerWith({ success: true, currency: 'eur', data: [direct] });
    const result = await provider.searchFlights(query);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.items).toHaveLength(1);
    expect(validateOffers(flightOfferSchema, result.value.items).rejected).toEqual([]);
    // No cursor: this endpoint has no paging, and claiming one would send the
    // pager round a loop.
    expect(result.value.nextCursor).toBeNull();
  });

  it('keeps the good price points and drops the rest', async () => {
    const { provider } = providerWith({
      success: true,
      data: [direct, { ...direct, transfers: 1 }, { nonsense: true }],
    });

    const result = await provider.searchFlights(query);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.items).toHaveLength(1);
  });

  it('reports a rate limit as unavailable rather than as a bad response', async () => {
    const { provider } = providerWith({}, 429);
    const result = await provider.searchFlights(query);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PROVIDER_UNAVAILABLE');
  });

  it('returns an error rather than throwing when the vendor misbehaves', async () => {
    const { provider } = providerWith({}, 500);
    const result = await provider.searchFlights(query);

    // Adapters are contracted to return `Result`, so one failing provider
    // degrades a search instead of aborting it.
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PROVIDER_ERROR');
  });

  it('returns an error when the response is not the shape we expect', async () => {
    const { provider } = providerWith({ unexpected: 'payload' });
    const result = await provider.searchFlights(query);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PROVIDER_ERROR');
  });

  it('reports a timeout as a timeout', async () => {
    const provider = new AviasalesFlightProvider({
      token: TOKEN,
      fetchImpl: () => Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
    });

    const result = await provider.searchFlights(query);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PROVIDER_TIMEOUT');
  });

  it('refuses to be built without a token', () => {
    expect(() => new AviasalesFlightProvider({ token: '' })).toThrow(/AVIASALES_API_TOKEN/);
  });

  it('declares itself real but indicative, and declares a rate limit the limiter can use', () => {
    const { provider } = providerWith({ data: [] });

    // `isMock: false` is what stops the result set being labelled demo data.
    // `mode: 'indicative'` is what stops it being labelled a live quote -
    // without it the registry's `isMock ? 'mock' : 'live'` fallback would
    // mislabel this always-stale cached price point as "Live price".
    expect(provider.metadata.isMock).toBe(false);
    expect(provider.metadata.mode).toBe('indicative');
    expect(provider.metadata.rateLimitPerMinute).toBeGreaterThan(0);
  });
});

/**
 * Replayed against the real recorded response.
 *
 * `tests/fixtures/providers/aviasales-prices-for-dates.json` is a real
 * Travelpayouts exchange, recorded once by `scripts/record-aviasales.mjs`
 * with the token redacted. These assertions are evidence about what the
 * vendor actually sends, not about what the documentation says it sends.
 */
describe('against the recorded Travelpayouts response', () => {
  const cassette = loadCassette('aviasales-prices-for-dates');
  const exchange = cassette.exchanges[0]!;
  const body = JSON.parse(exchange.response.body) as {
    currency: string;
    success: boolean;
    data: Record<string, unknown>[];
  };

  it('was a successful call carrying rows', () => {
    expect(exchange.response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
  });

  it('carries no credential', () => {
    // The fixture is a committed file; a token in it would be a token on
    // GitHub.
    expect(exchange.request.url).toContain('token=%5Bredacted%5D');
    expect(exchange.response.body).not.toContain('marker=');
  });

  it('matches the strict schema on every row', () => {
    // The point of the exercise: the schema was written from documentation
    // and is now checked against the real thing. Nothing malformed means the
    // shape is right.
    const outcomes = body.data.map((row) =>
      mapOffer(row, body.currency.toUpperCase(), '2026-09-22T13:46:18Z', 'aviasales'),
    );

    expect(outcomes.filter((o) => 'skipped' in o && o.skipped === 'malformed')).toHaveLength(0);
  });

  it('produces offers the domain boundary accepts', () => {
    const offers = body.data
      .map((row) => mapOffer(row, body.currency.toUpperCase(), '2026-09-22T13:46:18Z', 'aviasales'))
      .flatMap((o) => ('offer' in o ? [o.offer] : []));

    expect(offers.length).toBeGreaterThan(0);
    expect(validateOffers(flightOfferSchema, offers).rejected).toEqual([]);
  });

  it('refuses the connecting majority rather than inventing their segments', () => {
    const connecting = body.data.filter(
      (row) => (row.transfers as number) > 0 || (row.return_transfers as number) > 0,
    );

    // Most of what this endpoint returns cannot be represented honestly.
    expect(connecting.length).toBeGreaterThan(0);

    for (const row of connecting) {
      expect(mapOffer(row, 'EUR', '2026-09-22T13:46:18Z', 'aviasales')).toEqual({
        skipped: 'connecting',
      });
    }
  });

  it('sends each departure in the local zone of the airport it leaves from', () => {
    /*
     * The assumption that could have been silently hours wrong, settled by
     * the real payload: an outbound from Vienna in October carries +02:00,
     * which is Vienna's own offset that week, and the return from Antalya
     * carries +03:00, which is Turkey's. The offset tracks the departure
     * airport - so stripping it leaves the wall clock the domain wants.
     */
    const row = body.data.find((r) => r.origin === 'VIE' && r.destination === 'AYT');
    expect(row).toBeDefined();

    expect(String(row!.departure_at)).toMatch(/\+02:00$/);
    expect(String(row!.return_at)).toMatch(/\+03:00$/);
    expect(toLocalDateTime(String(row!.departure_at))).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });

  it('dates the price when the vendor searched it, not when we fetched it', () => {
    // Every link carries `search_date`, and in this recording it is two days
    // before the call. Reporting the fetch time would claim a two-day-old
    // fare was found a second ago.
    const row = body.data.find(
      (r) => typeof r.link === 'string' && /search_date=/.test(r.link as string),
    );
    expect(row).toBeDefined();

    const observed = observedFromLink(row!.link as string, '2026-09-22T13:46:18.000Z');
    expect(observed).not.toBe('2026-09-22T13:46:18.000Z');
    expect(Date.parse(observed)).toBeLessThan(Date.parse('2026-09-22T13:46:18.000Z'));
  });

  it('falls back to the fetch time when there is no search date to read', () => {
    expect(observedFromLink(undefined, 'fallback')).toBe('fallback');
    expect(observedFromLink('/search/x?search_date=nonsense', 'fallback')).toBe('fallback');
  });
});

describe('the experimental calendar window', () => {
  it('defaults to exact dates, so nothing changes unless asked', async () => {
    const { provider, seen } = providerWith({ success: true, data: [] });
    await provider.searchFlights(query);

    const url = new URL(seen[0]!);
    expect(url.searchParams.get('departure_at')).toBe('2026-06-10');
    expect(url.searchParams.get('return_at')).toBe('2026-06-15');
  });

  it('asks for whole months at both ends when selected', async () => {
    /*
     * Measured, not preferred on taste: exact date pairs returned nothing at
     * all on three of four routes, because the cache only holds pairs a real
     * user happened to search. Months return 25-57 rows.
     */
    const seen: string[] = [];
    const provider = new AviasalesFlightProvider({
      token: TOKEN,
      window: 'calendar',
      fetchImpl: (url) => {
        seen.push(url);
        return respond({ success: true, data: [] });
      },
    });

    await provider.searchFlights(query);

    const url = new URL(seen[0]!);
    expect(url.searchParams.get('departure_at')).toBe('2026-06');
    expect(url.searchParams.get('return_at')).toBe('2026-06');
    // Connecting rows are still refused downstream, but asking for them is
    // what makes the month's direct ones appear at all.
    expect(url.searchParams.get('direct')).toBe('false');
  });

  it('still refuses connecting rows in calendar mode', async () => {
    const provider = new AviasalesFlightProvider({
      token: TOKEN,
      window: 'calendar',
      fetchImpl: () => respond({ success: true, data: [direct, { ...direct, transfers: 1 }] }),
    });

    const result = await provider.searchFlights(query);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.items).toHaveLength(1);
  });
});
