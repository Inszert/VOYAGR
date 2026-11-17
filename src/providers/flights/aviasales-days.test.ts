import { beforeEach, describe, expect, it } from 'vitest';
import { money } from '@/core/money';
import { legArrival } from '@/core/trip/legs';
import { loadCassette } from '../http/cassette';
import { flightOfferSchema } from '../schema';
import {
  AviasalesFlightProvider,
  mapOffer,
  readDayRows,
  readV1CalendarRow,
  readV2LatestRow,
  readV3DayRow,
  resetAviasalesPause,
} from './aviasales';

// A 429 pauses the vendor for the whole process; one test's pause must not reach the next.
beforeEach(resetAviasalesPause);

/**
 * The party's price, the arrival nobody stated, and the single days of a
 * month - replayed from a real recording
 * (`tests/fixtures/providers/aviasales-day-coverage-vie-fco.json`, VIE-FCO,
 * December 2026, recorded by `scripts/probe-day-coverage.mjs`).
 */

const cassette = loadCassette('aviasales-day-coverage-vie-fco');
const bodyOf = (note: string) => {
  const exchange = cassette.exchanges.find((entry) => entry.note?.startsWith(note));
  if (!exchange?.response.body) throw new Error(`no exchange for ${note}`);
  return JSON.parse(exchange.response.body) as { data: unknown; currency?: string };
};

const FETCHED = '2026-11-15T21:00:00.000Z';
const query = (passengers = 1) => ({
  origin: 'VIE',
  destination: 'FCO',
  month: '2026-12',
  currency: 'EUR',
  passengers,
});

describe('a fare quoted for one adult', () => {
  const row = (bodyOf('prices_for_dates (month, return in month)').data as unknown[])[0];

  it('is the price of one traveller, from the link the vendor built', () => {
    // Every recorded link ends in the passenger count; it is 1 on every row.
    const rows = bodyOf('prices_for_dates (month, return in month)').data as { link: string }[];
    for (const { link } of rows)
      expect(link).toMatch(/^\/search\/[A-Z]{3}\d{4}[A-Z]{3}(\d{4})?1(\?|$)/);
  });

  it('becomes the party total, exactly', () => {
    const one = mapOffer(row, 'EUR', FETCHED, 'aviasales', 1);
    const four = mapOffer(row, 'EUR', FETCHED, 'aviasales', 4);
    if (!('offer' in one) || !('offer' in four)) throw new Error('row did not map');

    expect(four.offer.price.amount).toBe(one.offer.price.amount * 4);
  });

  it('is asked for and priced for the party in a search', async () => {
    const provider = new AviasalesFlightProvider({
      token: 'test-token-not-a-real-credential',
      fetchImpl: () =>
        Promise.resolve(new Response(JSON.stringify({ currency: 'eur', data: [row] }))),
    });
    const result = await provider.searchFlights({
      origins: ['VIE'],
      destinations: ['FCO'],
      departureDate: '2026-12-11',
      returnDate: '2026-12-12',
      passengers: 3,
      currency: 'EUR',
    });
    if (!result.ok) throw new Error('search failed');

    const fare = (row as { price: number }).price;
    expect(result.value.items[0]!.price).toEqual(money(fare * 100 * 3, 'EUR'));
  });
});

describe('an arrival the vendor did not state', () => {
  it('is null, never the departure repeated', () => {
    const row = (bodyOf('prices_for_dates (month, return in month)').data as unknown[])[0];
    const mapped = mapOffer(row, 'EUR', FETCHED, 'aviasales');
    if (!('offer' in mapped)) throw new Error('row did not map');

    const segment = mapped.offer.outbound.segments[0]!;
    expect(segment.departsAt).toMatch(/T\d{2}:\d{2}$/);
    expect(segment.arrivesAt).toBeNull();
    expect(legArrival(mapped.offer.outbound)).toBeNull();
    // And the boundary takes the explicit null.
    expect(flightOfferSchema.safeParse(mapped.offer).success).toBe(true);
  });

  it('is also unknown for a result cached before the fix, which repeated the departure', () => {
    expect(
      legArrival({
        segments: [
          {
            origin: 'VIE',
            destination: 'FCO',
            departsAt: '2026-12-01T06:10',
            arrivesAt: '2026-12-01T06:10',
            carrier: 'OS',
            flightNumber: 'OS501',
          },
        ],
        durationMinutes: 105,
        cabinBaggageIncluded: null,
        checkedBaggageIncluded: null,
        selfTransfer: null,
      }),
    ).toBeNull();
  });
});

describe('single days of a month', () => {
  it('reads the one-way answer as one-way fares at the airport asked about', () => {
    const read = readDayRows(
      bodyOf('prices_for_dates (month, one way)'),
      query(2),
      readV3DayRow,
      FETCHED,
    );
    if (!read) throw new Error('unrecognised body');

    expect(read.fares.length).toBe(30);
    expect(read.dropped).toBe(0);
    for (const fare of read.fares) {
      expect(fare.returnDate).toBeNull();
      expect(fare.departureDate.startsWith('2026-12')).toBe(true);
      // Two travellers: every figure is a whole even number of euros.
      expect(fare.price.amount % 200).toBe(0);
      // Each keeps when the vendor saw it, read from its own link.
      expect(fare.observedAt).toMatch(/^2026-11-\d{2}T00:00:00.000Z$/);
    }
  });

  it('drops the city-level answers for an airport they do not name, and counts them', () => {
    // Asked for FCO, both reply for ROM - which includes Ciampino.
    for (const [note, reader] of [
      ['prices/calendar', readV1CalendarRow],
      ['prices/latest', readV2LatestRow],
    ] as const) {
      const read = readDayRows(bodyOf(note), query(), reader, FETCHED);
      if (!read) throw new Error(`unrecognised body for ${note}`);
      expect(read.fares).toHaveLength(0);
      expect(read.dropped).toBeGreaterThan(0);
    }
  });

  it('keeps a city-level answer where the city is what was asked', () => {
    const asRome = { ...query(), destination: 'ROM' };
    const calendar = readDayRows(bodyOf('prices/calendar'), asRome, readV1CalendarRow, FETCHED);
    const latest = readDayRows(bodyOf('prices/latest'), asRome, readV2LatestRow, FETCHED);

    expect(calendar!.fares.length).toBe(19);
    expect(calendar!.fares.every((fare) => fare.returnDate !== null)).toBe(true);
    // The calendar never says when a price was found: unknown, not now.
    expect(calendar!.fares.every((fare) => fare.observedAt === null)).toBe(true);
    // `found_at` came without a zone, so it is no instant either.
    expect(latest!.fares.length).toBeGreaterThan(0);
    expect(latest!.fares.every((fare) => fare.observedAt === null)).toBe(true);
  });

  it('drops a malformed row rather than failing the answer', () => {
    const read = readDayRows(
      { currency: 'eur', data: [{ origin: 'VIE', destination: 'FCO', price: 'cheap' }] },
      query(),
      readV3DayRow,
      FETCHED,
    );
    expect(read).toEqual({ fares: [], dropped: 1 });
  });

  it('refuses a body that is not an answer at all', () => {
    expect(readDayRows({ nope: true }, query(), readV3DayRow, FETCHED)).toBeNull();
  });

  it('asks each question as its own call, with the token and never with it in a log', async () => {
    const seen: string[] = [];
    const provider = new AviasalesFlightProvider({
      token: 'test-token-not-a-real-credential',
      fetchImpl: (url) => {
        seen.push(url);
        return Promise.resolve(new Response(JSON.stringify({ currency: 'eur', data: [] })));
      },
    });

    expect(provider.monthFareSources.map((source) => source.id)).toEqual([
      'aviasales.prices_for_dates.one_way',
      'aviasales.prices.calendar',
      'aviasales.prices.latest',
    ]);
    for (const source of provider.monthFareSources) {
      const result = await source.fetch(query());
      expect(result.ok).toBe(true);
    }
    expect(seen).toHaveLength(3);
    expect(seen[0]).toContain('one_way=true');
    expect(seen.every((url) => url.includes('token=test-token'))).toBe(true);
  });

  it('degrades a failing question to an error result, never a throw', async () => {
    const provider = new AviasalesFlightProvider({
      token: 'test-token-not-a-real-credential',
      fetchImpl: () => Promise.resolve(new Response('busy', { status: 429 })),
    });
    const result = await provider.monthFareSources[0]!.fetch(query());
    expect(result.ok).toBe(false);
  });
});

describe('a 429 from the Travelpayouts rate limit (real shape: text/plain, x-rate-limit-* headers)', () => {
  const throttled = (reset: string) =>
    new Response('Too Many Requests', {
      status: 429,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'x-rate-limit': '600',
        'x-rate-limit-remaining': '0',
        'x-rate-limit-reset': reset,
      },
    });
  const okBody = JSON.stringify({ success: true, currency: 'eur', data: [] });

  it('waits out a short reset once, then answers', async () => {
    const sleeps: number[] = [];
    let calls = 0;
    const provider = new AviasalesFlightProvider({
      token: 'test-token-not-a-real-credential',
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
      fetchImpl: () => Promise.resolve((calls += 1) === 1 ? throttled('3') : new Response(okBody)),
    });
    const result = await provider.monthFareSources[0]!.fetch(query());
    expect(calls).toBe(2);
    expect(sleeps).toEqual([3250]);
    expect(result.ok).toBe(true);
  });

  it('does not stall a search on a long reset: one call, unavailable', async () => {
    let calls = 0;
    const provider = new AviasalesFlightProvider({
      token: 'test-token-not-a-real-credential',
      sleep: () => Promise.reject(new Error('must not wait')),
      fetchImpl: () => {
        calls += 1;
        return Promise.resolve(throttled('52'));
      },
    });
    const result = await provider.monthFareSources[0]!.fetch(query());
    expect(calls).toBe(1);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PROVIDER_UNAVAILABLE');
  });
});

describe('the pause after a 429', () => {
  const throttled = (reset?: string) =>
    new Response('Too Many Requests', {
      status: 429,
      headers: reset === undefined ? {} : { 'x-rate-limit-reset': reset },
    });
  const okBody = () => new Response(JSON.stringify({ success: true, currency: 'eur', data: [] }));

  const setup = (reply: () => Response) => {
    const clock = { ms: Date.parse('2026-11-16T10:00:00Z') };
    let calls = 0;
    const provider = new AviasalesFlightProvider({
      token: 'test-token-not-a-real-credential',
      now: () => new Date(clock.ms),
      sleep: () => Promise.reject(new Error('must not wait')),
      fetchImpl: () => {
        calls += 1;
        return Promise.resolve(reply());
      },
    });
    const ask = () => provider.monthFareSources[0]!.fetch(query());
    return { clock, ask, calls: () => calls };
  };

  it('fails the next call at once, with no request, and does not retry it', async () => {
    const { ask, calls } = setup(() => throttled('30'));
    await ask();
    expect(calls()).toBe(1);

    const next = await ask();
    const third = await ask();
    expect(calls()).toBe(1);
    expect(next.ok).toBe(false);
    expect(third.ok).toBe(false);
    if (!next.ok) expect(next.error.code).toBe('PROVIDER_UNAVAILABLE');
  });

  it('ends after the reset and calls resume', async () => {
    let answer = () => throttled('30');
    const { clock, ask, calls } = setup(() => answer());
    await ask();
    clock.ms += 29_000;
    await ask();
    expect(calls()).toBe(1);

    answer = okBody;
    clock.ms += 1_001;
    const resumed = await ask();
    expect(calls()).toBe(2);
    expect(resumed.ok).toBe(true);
  });

  it('is ten seconds when the header is missing', async () => {
    const { clock, ask, calls } = setup(() => throttled());
    await ask();
    clock.ms += 9_999;
    await ask();
    expect(calls()).toBe(1);
    clock.ms += 2;
    await ask();
    expect(calls()).toBe(2);
  });

  it('is capped at sixty seconds', async () => {
    const { clock, ask, calls } = setup(() => throttled('3600'));
    await ask();
    clock.ms += 59_999;
    await ask();
    expect(calls()).toBe(1);
    clock.ms += 2;
    await ask();
    expect(calls()).toBe(2);
  });

  it('is shared by every provider instance in the process', async () => {
    const a = setup(() => throttled('30'));
    const b = setup(() => okBody());
    await a.ask();
    const other = await b.ask();
    expect(b.calls()).toBe(0);
    expect(other.ok).toBe(false);
  });
});

describe('single flights one way, for two-ticket trips (recorded VIE-KZN)', () => {
  const kzn = loadCassette('aviasales-one-way-vie-kzn');
  const answer = (note: string) =>
    kzn.exchanges.find((entry) => entry.note === note)!.response.body!;

  it('maps every recorded row to a one-way leg with no invented arrival', async () => {
    const provider = new AviasalesFlightProvider({
      token: 'test-token-not-a-real-credential',
      now: () => new Date('2026-11-16T00:00:00Z'),
      fetchImpl: () => Promise.resolve(new Response(answer('one-way VIE->KZN 2026-11'))),
    });
    const result = await provider.searchOneWay({
      origin: 'VIE',
      destination: 'KZN',
      month: '2026-11',
      currency: 'EUR',
      passengers: 2,
    });
    if (!result.ok) throw new Error('one-way search failed');

    const rows = JSON.parse(answer('one-way VIE->KZN 2026-11')).data as { price: number }[];
    expect(result.value).toHaveLength(rows.length);
    expect(
      new Set(result.value.map((fare) => fare.leg.segments[0]!.departsAt.slice(0, 10))).size,
    ).toBe(13);
    for (const [index, fare] of result.value.entries()) {
      expect(fare.leg.segments[0]!.arrivesAt).toBeNull();
      expect(fare.leg.segments[0]!.origin).toBe('VIE');
      // Two travellers: the one-adult fare, twice, exactly.
      expect(fare.price).toEqual(money(rows[index]!.price * 100 * 2, 'EUR'));
    }
  });
});
