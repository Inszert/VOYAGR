import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createMcpClient } from '../mcp/client';
import { scriptedTransport, type FakeBehaviour } from '../mcp/fake-transport';
import {
  createKiwiMcpFlightProvider,
  mapOneWayItinerary,
  mapReturnItinerary,
  parseSearchFlight,
  toKiwiDate,
} from './kiwi-mcp';

/** The recorded answer to `search-flight` VIE to LIS on 15/12/2026. No network is used anywhere here. */
const FIXTURE = readFileSync(
  fileURLToPath(new URL('../mcp/fixtures/kiwi-search-flight-vie-lis.raw.txt', import.meta.url)),
  'utf8',
);
const RECORDED = JSON.parse(FIXTURE) as { itineraries: Array<Record<string, unknown>> };
const OBSERVED = '2026-11-28T10:00:00.000Z';

function providerFor(script: FakeBehaviour[]) {
  const transport = scriptedTransport(script);
  const client = createMcpClient({
    transportFactory: transport.factory,
    sleep: async () => undefined,
    random: () => 0,
    minIntervalMs: 0,
  });
  return {
    provider: createKiwiMcpFlightProvider({ client, now: () => new Date(OBSERVED) }),
    transport,
  };
}

const ONE_WAY_QUERY = {
  origin: 'VIE',
  destination: 'LIS',
  month: '2026-12',
  currency: 'EUR',
  passengers: 1,
};

function payload(itineraries: unknown[], extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ query: 'q', currency: 'EUR', itineraries, error: null, ...extra });
}

/** A minimal, valid return itinerary. */
function returnItinerary(overrides: Record<string, unknown> = {}) {
  const segment = (from: string, to: string, dep: string, arr: string, n: string) => ({
    from,
    to,
    departureTime: dep,
    arrivalTime: arr,
    durationSeconds: 9000,
    carrier: 'FR',
    flightNumber: n,
  });
  return {
    id: 'ret-1',
    price: 212.5,
    bookingUrl: 'https://kiwi.com/u/abc123',
    baggage: { personalItem: 1, cabinBag: 1, checkedBag: 0 },
    outbound: {
      from: 'VIE',
      to: 'LIS',
      durationSeconds: 9000,
      stops: 0,
      segments: [segment('VIE', 'LIS', '2026-12-15T06:00:00', '2026-12-15T08:30:00', 'FR1')],
    },
    inbound: {
      from: 'LIS',
      to: 'VIE',
      durationSeconds: 9000,
      stops: 0,
      segments: [segment('LIS', 'VIE', '2026-12-20T09:00:00', '2026-12-20T12:30:00', 'FR2')],
    },
    ...overrides,
  };
}

describe('kiwi-mcp: the recorded answer', () => {
  it('maps all 15 itineraries as single flights, in minor units, bookingUrl untouched', async () => {
    const { provider } = providerFor([{ text: FIXTURE }]);
    const result = await provider.searchOneWay(ONE_WAY_QUERY);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(15);

    const first = result.value[0]!;
    expect(first.price).toEqual({ amount: 10600, currency: 'EUR' });
    expect(first.deepLink).toBe('https://kiwi.com/u/pfxtgw5fpn');
    expect(first.providerId).toBe('kiwi-mcp');
    expect(first.observedAt).toBe(OBSERVED);
    expect(first.leg.durationMinutes).toBe(755);
    expect(first.leg.segments.map((s) => s.flightNumber)).toEqual(['FR214', 'FR820']);
    expect(first.leg.segments[0]!.departsAt).toBe('2026-12-15T06:00');

    // Every fare is a whole number of cents and carries its own booking link.
    for (const fare of result.value) {
      expect(Number.isInteger(fare.price.amount)).toBe(true);
      expect(fare.deepLink).toMatch(/^https:\/\/kiwi\.com\/u\//);
    }
    const sources = RECORDED.itineraries.map((i) => i.bookingUrl);
    expect(result.value.map((f) => f.deepLink)).toEqual(sources);
  });

  it('states baggage when the answer does, and says self transfer only when the segments prove it', async () => {
    const { provider } = providerFor([{ text: FIXTURE }]);
    const result = await provider.searchOneWay(ONE_WAY_QUERY);
    if (!result.ok) throw result.error;

    const [viaMilan, direct] = result.value;
    // VIE-MXP then BGY-LIS: it lands at one airport and leaves from another.
    expect(viaMilan!.leg.selfTransfer).toBe(true);
    expect(viaMilan!.leg.cabinBaggageIncluded).toBe(false);
    expect(viaMilan!.leg.checkedBaggageIncluded).toBe(false);
    // Nothing in the answer says a direct flight is one ticket, so it is unknown, not false.
    expect(direct!.leg.selfTransfer).toBeNull();
  });

  it('asks the server for the whole month in its own date format, with the cheapest first', async () => {
    const asked: unknown[] = [];
    const client = {
      callTool: async (_name: string, args: Record<string, unknown>) => {
        asked.push(args);
        return { ok: true as const, value: { text: FIXTURE } };
      },
      close: async () => undefined,
    };
    const provider = createKiwiMcpFlightProvider({ client });
    await provider.searchOneWay(ONE_WAY_QUERY);
    expect(asked[0]).toMatchObject({
      flyFrom: 'VIE',
      flyTo: 'LIS',
      departureDate: '01/12/2026',
      departureDateTo: '31/12/2026',
      sort: 'price',
    });
    expect(toKiwiDate('2026-12-15')).toBe('15/12/2026');
  });

  it('drops one-way itineraries from a return search and counts them, never inventing an inbound', async () => {
    const parsed = parseSearchFlight(FIXTURE, OBSERVED, mapReturnItinerary);
    expect('failed' in parsed).toBe(false);
    if ('failed' in parsed) return;
    expect(parsed.items).toHaveLength(0);
    expect(parsed.dropped.no_inbound).toBe(15);
  });
});

describe('kiwi-mcp: return trips', () => {
  it('maps a return itinerary to a FlightOffer with both legs', async () => {
    const { provider } = providerFor([{ text: payload([returnItinerary()]) }]);
    const result = await provider.searchFlights({
      origins: ['VIE'],
      destinations: ['LIS'],
      departureDate: '2026-12-15',
      returnDate: '2026-12-20',
      passengers: 1,
      currency: 'EUR',
    });
    if (!result.ok) throw result.error;

    const [offer] = result.value.items;
    expect(result.value.items).toHaveLength(1);
    expect(offer!.price).toEqual({ amount: 21250, currency: 'EUR' });
    expect(offer!.outbound.segments[0]!.origin).toBe('VIE');
    expect(offer!.inbound.segments[0]!.destination).toBe('VIE');
    expect(offer!.outbound.cabinBaggageIncluded).toBe(true);
    expect(offer!.outbound.checkedBaggageIncluded).toBe(false);
    expect(offer!.deepLink).toBe('https://kiwi.com/u/abc123');
    expect(result.value.nextCursor).toBeNull();
  });
});

describe('kiwi-mcp: empty, malformed and partial answers', () => {
  it('an empty result is a success with nothing in it', async () => {
    const { provider } = providerFor([{ text: payload([]) }]);
    const result = await provider.searchOneWay(ONE_WAY_QUERY);
    expect(result).toEqual({ ok: true, value: [] });
  });

  it('an empty result that carries a server error is a failure, not an empty page', async () => {
    const { provider } = providerFor([{ text: payload([], { error: 'upstream broke' }) }]);
    const result = await provider.searchOneWay(ONE_WAY_QUERY);
    expect(result.ok).toBe(false);
  });

  it('text that is not JSON, or not the expected shape, is a failure', async () => {
    for (const text of ['<html>oops</html>', '{"hello":1}', '[]']) {
      const { provider } = providerFor([{ text }]);
      const result = await provider.searchOneWay(ONE_WAY_QUERY);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe('PROVIDER_ERROR');
    }
  });

  it('drops malformed itineraries one by one and counts why', () => {
    const good = RECORDED.itineraries[1];
    const noPrice = { ...RECORDED.itineraries[2], price: 'cheap' };
    const zoned = structuredClone(RECORDED.itineraries[3]) as {
      outbound: { segments: Array<{ departureTime: string }> };
    };
    zoned.outbound.segments[0]!.departureTime += 'Z';
    const badLink = { ...RECORDED.itineraries[4], bookingUrl: 'https://evil.example/u/x' };
    const notAnObject = 'nope';

    const text = payload([good, noPrice, zoned, badLink, notAnObject, null]);
    const parsed = parseSearchFlight(text, OBSERVED, mapOneWayItinerary);
    if ('failed' in parsed) throw new Error(parsed.failed);

    expect(parsed.items).toHaveLength(1);
    expect(parsed.dropped.malformed).toBe(4);
    expect(parsed.dropped.unparsable_time).toBe(1);
  });

  it('keeps the good itineraries when others in the same answer are bad (partial results)', async () => {
    const mixed = [
      RECORDED.itineraries[0],
      { id: 'x' },
      RECORDED.itineraries[1],
      { ...RECORDED.itineraries[2], price: -4 },
    ];
    const { provider } = providerFor([{ text: payload(mixed) }]);
    const result = await provider.searchOneWay(ONE_WAY_QUERY);
    if (!result.ok) throw result.error;
    expect(result.value.map((f) => f.price.amount)).toEqual([10600, 10700]);
  });

  it('drops an itinerary whose segments contradict its own route', () => {
    const broken = returnItinerary();
    broken.outbound.to = 'OPO';
    const mapped = mapReturnItinerary(broken, 'EUR', OBSERVED);
    expect(mapped).toEqual({ skipped: 'inconsistent_route' });
  });

  it('leaves baggage unknown when the answer does not state it', () => {
    const { baggage: _omit, ...withoutBaggage } = returnItinerary();
    const mapped = mapReturnItinerary(withoutBaggage, 'EUR', OBSERVED);
    if (!('value' in mapped)) throw new Error('expected an offer');
    expect(mapped.value.outbound.cabinBaggageIncluded).toBeNull();
    expect(mapped.value.outbound.checkedBaggageIncluded).toBeNull();
  });
});

describe('kiwi-mcp: when the server misbehaves', () => {
  it('retries 5xx and then gives up with a provider error, not a throw', async () => {
    const { provider, transport } = providerFor([{ http: 503 }]);
    const result = await provider.searchOneWay(ONE_WAY_QUERY);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PROVIDER_UNAVAILABLE');
    expect(transport.calls()).toBe(3);
  });

  it('retries a 429 and reports it as rate limited', async () => {
    const { provider, transport } = providerFor([{ http: 429 }]);
    const result = await provider.searchOneWay(ONE_WAY_QUERY);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('RATE_LIMITED');
    expect(transport.calls()).toBe(3);
  });

  it('recovers when a retry succeeds', async () => {
    const { provider } = providerFor([{ http: 502 }, { text: FIXTURE }]);
    const result = await provider.searchOneWay(ONE_WAY_QUERY);
    if (!result.ok) throw result.error;
    expect(result.value).toHaveLength(15);
  });

  it('times out on an injected timer, without waiting', async () => {
    const transport = scriptedTransport([{ hang: true }]);
    const client = createMcpClient({
      transportFactory: transport.factory,
      sleep: async () => undefined,
      random: () => 0,
      minIntervalMs: 0,
      maxRetries: 0,
      timer: {
        setTimeout: (fn) => {
          void Promise.resolve().then(fn);
          return 1;
        },
        clearTimeout: () => undefined,
      },
    });
    const provider = createKiwiMcpFlightProvider({ client });
    const result = await provider.searchOneWay(ONE_WAY_QUERY);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PROVIDER_TIMEOUT');
  });

  it('refuses a search with no origin or destination without calling the server', async () => {
    const { provider, transport } = providerFor([{ text: FIXTURE }]);
    const result = await provider.searchFlights({
      origins: [],
      destinations: ['LIS'],
      departureDate: '2026-12-15',
      returnDate: '2026-12-20',
      passengers: 1,
      currency: 'EUR',
    });
    expect(result.ok).toBe(false);
    expect(transport.calls()).toBe(0);
  });
});
