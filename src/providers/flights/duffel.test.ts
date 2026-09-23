import { describe, expect, it } from 'vitest';
import { flightOfferSchema, validateOffers } from '../schema';
import {
  createDuffelFlightProvider,
  DuffelFlightProvider,
  durationMinutes,
  mapDuffelOffer,
} from './duffel';
import { loadCassette, replayingFetch } from '../http/cassette';

/**
 * The Duffel adapter, offline.
 *
 * Shapes here are taken from a real recorded response: a round trip VIE-BCN
 * for two adults, which returned 742 offers of which 47 in every 60 carried
 * a connection.
 */

const TOKEN = 'duffel_test_not-a-real-credential';

const segment = (
  origin: string,
  destination: string,
  departing: string,
  arriving: string,
  carrier: string,
  number: string,
  bags = [
    { type: 'checked', quantity: 1 },
    { type: 'carry_on', quantity: 1 },
  ],
) => ({
  origin: { iata_code: origin },
  destination: { iata_code: destination },
  departing_at: departing,
  arriving_at: arriving,
  duration: 'PT2H30M',
  marketing_carrier: { iata_code: carrier },
  marketing_carrier_flight_number: number,
  passengers: [{ baggages: bags }],
});

const offer = {
  id: 'off_123',
  live_mode: false,
  total_amount: '117.96',
  total_currency: 'EUR',
  created_at: '2026-09-22T14:42:57.268382Z',
  expires_at: '2026-09-22T14:57:57.236180Z',
  owner: { name: 'Vueling' },
  slices: [
    {
      duration: 'PT2H30M',
      segments: [segment('VIE', 'BCN', '2026-10-22T11:15:00', '2026-10-22T13:45:00', 'VY', '8715')],
    },
    {
      duration: 'PT4H10M',
      segments: [
        segment('BCN', 'ZRH', '2026-10-29T14:55:00', '2026-10-29T16:40:00', 'LX', '1955'),
        segment('ZRH', 'VIE', '2026-10-29T17:45:00', '2026-10-29T19:05:00', 'LX', '3536'),
      ],
    },
  ],
};

const map = (raw: unknown) => mapDuffelOffer(raw, 'duffel');

describe('durationMinutes', () => {
  it('reads an ISO 8601 duration', () => {
    expect(durationMinutes('PT2H30M')).toBe(150);
    expect(durationMinutes('PT45M')).toBe(45);
    expect(durationMinutes('PT13H')).toBe(780);
    expect(durationMinutes('P1DT2H')).toBe(1560);
  });

  it('has no answer for anything else', () => {
    expect(durationMinutes('two hours')).toBeNull();
    expect(durationMinutes(null)).toBeNull();
  });
});

describe('mapDuffelOffer', () => {
  it('maps an offer the domain boundary accepts', () => {
    const result = map(offer);

    expect('offer' in result).toBe(true);
    if (!('offer' in result)) return;

    expect(validateOffers(flightOfferSchema, [result.offer]).rejected).toEqual([]);
  });

  it('keeps the validity window Duffel states, and says nothing when it states none', () => {
    const stated = map(offer);
    if (!('offer' in stated)) throw new Error('expected an offer');
    expect(stated.offer.expiresAt).toBe('2026-09-22T14:57:57.236180Z');

    const { expires_at: _omitted, ...unstated } = offer;
    const silent = map(unstated as typeof offer);
    if (!('offer' in silent)) throw new Error('expected an offer');
    expect(silent.offer.expiresAt).toBeNull();
  });

  it('keeps every segment of a connecting leg', () => {
    const result = map(offer);
    if (!('offer' in result)) throw new Error('expected an offer');

    // The whole reason this provider is worth having: a connection is
    // described rather than refused.
    expect(result.offer.inbound.segments).toHaveLength(2);
    expect(result.offer.inbound.segments.map((s) => `${s.origin}-${s.destination}`)).toEqual([
      'BCN-ZRH',
      'ZRH-VIE',
    ]);
    expect(result.offer.inbound.segments[1]?.flightNumber).toBe('LX3536');
  });

  it('takes the leg duration from the slice, so layovers are counted', () => {
    const result = map(offer);
    if (!('offer' in result)) throw new Error('expected an offer');

    // Summing the segments would give 300 and lose the hour on the ground at
    // Zurich - which is the part a traveller actually feels.
    expect(result.offer.inbound.durationMinutes).toBe(250);
  });

  it('keeps Duffel local times as wall clocks', () => {
    const result = map(offer);
    if (!('offer' in result)) throw new Error('expected an offer');

    expect(result.offer.outbound.segments[0]?.departsAt).toBe('2026-10-22T11:15');
  });

  it('converts a string amount through fromMajor', () => {
    const result = map(offer);
    if (!('offer' in result)) throw new Error('expected an offer');

    expect(result.offer.price).toEqual({ amount: 11_796, currency: 'EUR' });
  });

  it('dates the offer when Duffel created it', () => {
    const result = map(offer);
    if (!('offer' in result)) throw new Error('expected an offer');

    expect(result.offer.observedAt).toBe('2026-09-22T14:42:57.268382Z');
  });

  it('reports a stated baggage allowance', () => {
    const result = map(offer);
    if (!('offer' in result)) throw new Error('expected an offer');

    expect(result.offer.outbound.checkedBaggageIncluded).toBe(true);
    expect(result.offer.outbound.cabinBaggageIncluded).toBe(true);
  });

  it('reports silence about baggage as null, never as false', () => {
    const silent = {
      ...offer,
      slices: [
        {
          duration: 'PT2H',
          segments: [
            segment('VIE', 'BCN', '2026-10-22T11:15:00', '2026-10-22T13:45:00', 'VY', '1', []),
          ],
        },
        {
          duration: 'PT2H',
          segments: [
            segment('BCN', 'VIE', '2026-10-29T11:15:00', '2026-10-29T13:45:00', 'VY', '2', []),
          ],
        },
      ],
    };

    const result = map(silent);
    if (!('offer' in result)) throw new Error('expected an offer');

    // `false` would be a claim the carrier never made, in the field the
    // No-Surprise check reads.
    expect(result.offer.outbound.checkedBaggageIncluded).toBeNull();
  });

  it('requires the allowance on every segment of a leg', () => {
    const half = {
      ...offer,
      slices: [
        offer.slices[0],
        {
          duration: 'PT4H10M',
          segments: [
            segment('BCN', 'ZRH', '2026-10-29T14:55:00', '2026-10-29T16:40:00', 'LX', '1955'),
            segment('ZRH', 'VIE', '2026-10-29T17:45:00', '2026-10-29T19:05:00', 'LX', '3536', [
              { type: 'carry_on', quantity: 1 },
            ]),
          ],
        },
      ],
    };

    const result = map(half);
    if (!('offer' in result)) throw new Error('expected an offer');

    // A bag that has to be rechecked on the second flight is not an
    // allowance for the journey.
    expect(result.offer.inbound.checkedBaggageIncluded).toBe(false);
  });

  it('reports whether the offer was live inventory', () => {
    expect(map(offer)).toMatchObject({ liveMode: false });
    expect(map({ ...offer, live_mode: true })).toMatchObject({ liveMode: true });
  });

  it('refuses a one-way offer rather than bending it into a round trip', () => {
    expect(map({ ...offer, slices: [offer.slices[0]] })).toEqual({ skipped: 'one_way' });
  });

  it('refuses a segment missing an airport or a carrier', () => {
    const broken = {
      ...offer,
      slices: [
        {
          duration: 'PT2H',
          segments: [
            {
              ...segment('VIE', 'BCN', '2026-10-22T11:15:00', '2026-10-22T13:45:00', 'VY', '1'),
              marketing_carrier: null,
            },
          ],
        },
        offer.slices[1],
      ],
    };

    expect(map(broken)).toEqual({ skipped: 'incomplete_segment' });
  });

  it('refuses nonsense', () => {
    expect(map(null)).toEqual({ skipped: 'malformed' });
    expect(map({ ...offer, total_amount: 'free' })).toEqual({ skipped: 'malformed' });
  });
});

describe('DuffelFlightProvider', () => {
  const respond = (body: unknown, status = 200) =>
    Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );

  /**
   * The adapter makes two calls: create the request, then fetch a sorted
   * page of offers. This answers both, so a test says what the *vendor*
   * returns rather than how many times it was asked.
   */
  const twoStep = (offers: readonly unknown[], status = 200) => {
    let call = 0;

    return () => {
      call += 1;
      if (status !== 200) return respond({}, status);

      return call === 1 ? respond({ data: { id: 'orq_1' } }) : respond({ data: offers });
    };
  };

  it('labels a test key as test, never as live', () => {
    const provider = new DuffelFlightProvider({ token: TOKEN });

    expect(provider.metadata.mode).toBe('test');
    expect(provider.metadata.isMock).toBe(false);
  });

  it('labels a live key as live', () => {
    expect(new DuffelFlightProvider({ token: 'duffel_live_abc' }).metadata.mode).toBe('live');
  });

  it('downgrades to test when the response says so, whatever the key looked like', async () => {
    // The response is the fact; the key prefix is only a hint.
    const provider = new DuffelFlightProvider({
      token: 'duffel_live_abc',
      fetchImpl: twoStep([offer]),
    });

    await provider.searchFlights({
      origins: ['VIE'],
      destinations: ['BCN'],
      departureDate: '2026-10-22',
      returnDate: '2026-10-29',
      passengers: 2,
      currency: 'EUR',
    });

    expect(provider.metadata.mode).toBe('test');
  });

  it('sends a two-slice round trip with one passenger entry each', async () => {
    let sent: string | undefined;

    const provider = new DuffelFlightProvider({
      token: TOKEN,
      fetchImpl: (_url, init) => {
        sent ??= init?.body as string;
        return respond({ data: { id: 'orq_1' } });
      },
    });

    await provider.searchFlights({
      origins: ['VIE'],
      destinations: ['BCN'],
      departureDate: '2026-10-22',
      returnDate: '2026-10-29',
      passengers: 2,
      currency: 'EUR',
    });

    const body = JSON.parse(sent!);
    expect(body.data.slices).toHaveLength(2);
    expect(body.data.slices[1]).toMatchObject({ origin: 'BCN', destination: 'VIE' });
    expect(body.data.passengers).toHaveLength(2);
  });

  it('caps how many offers it keeps', async () => {
    const provider = new DuffelFlightProvider({
      token: TOKEN,
      maxOffers: 2,
      fetchImpl: twoStep([offer, offer, offer, offer]),
    });

    const result = await provider.searchFlights({
      origins: ['VIE'],
      destinations: ['BCN'],
      departureDate: '2026-10-22',
      returnDate: '2026-10-29',
      passengers: 1,
      currency: 'EUR',
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.items).toHaveLength(2);
  });

  it('turns a rate limit into unavailable and a failure into an error', async () => {
    for (const [status, code] of [
      [429, 'PROVIDER_UNAVAILABLE'],
      [500, 'PROVIDER_ERROR'],
    ] as const) {
      const provider = new DuffelFlightProvider({
        token: TOKEN,
        fetchImpl: () => respond({}, status),
      });

      const result = await provider.searchFlights({
        origins: ['VIE'],
        destinations: ['BCN'],
        departureDate: '2026-10-22',
        returnDate: '2026-10-29',
        passengers: 1,
        currency: 'EUR',
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe(code);
    }
  });

  it('refuses to be built without a key', () => {
    expect(() => new DuffelFlightProvider({ token: '' })).toThrow(/DUFFEL/);
  });

  it('tells Duffel how long it may wait for the airlines', async () => {
    const bodies: string[] = [];
    let call = 0;

    const provider = new DuffelFlightProvider({
      token: TOKEN,
      fetchImpl: (_url, init) => {
        call += 1;
        if (init?.body) bodies.push(String(init.body));
        return call === 1 ? respond({ data: { id: 'orq_1' } }) : respond({ data: [] });
      },
    });

    await provider.searchFlights({
      origins: ['VIE'],
      destinations: ['BCN'],
      departureDate: '2026-10-22',
      returnDate: '2026-10-29',
      passengers: 1,
      currency: 'EUR',
    });

    // Without it Duffel waits for the slowest airline, which measured at
    // twenty seconds - longer than any search page should block for.
    expect(JSON.parse(bodies[0] as string).data.supplier_timeout).toBe(8_000);
  });

  it('keeps the supplier wait inside what the API accepts', () => {
    const body = async (supplierTimeoutMs: number) => {
      const bodies: string[] = [];
      let call = 0;

      const provider = new DuffelFlightProvider({
        token: TOKEN,
        supplierTimeoutMs,
        fetchImpl: (_url, init) => {
          call += 1;
          if (init?.body) bodies.push(String(init.body));
          return call === 1 ? respond({ data: { id: 'orq_1' } }) : respond({ data: [] });
        },
      });

      return provider
        .searchFlights({
          origins: ['VIE'],
          destinations: ['BCN'],
          departureDate: '2026-10-22',
          returnDate: '2026-10-29',
          passengers: 1,
          currency: 'EUR',
        })
        .then(() => JSON.parse(bodies[0] as string).data.supplier_timeout as number);
    };

    // Duffel takes 2000-60000 and rejects the request outside it, so a
    // mistuned option must not become a 422 on every search.
    return Promise.all([body(10), body(120_000)]).then(([low, high]) => {
      expect(low).toBe(2_000);
      expect(high).toBe(60_000);
    });
  });

  it('asks the search for longer than the eight seconds a mock needs', () => {
    // A vendor that polls airlines cannot answer inside a timeout chosen for
    // one that answers from an index, and every call was being aborted.
    const provider = new DuffelFlightProvider({ token: TOKEN });

    expect(provider.metadata.operationOverrides?.search?.timeoutMs).toBe(12_000);
    expect(provider.metadata.typicalLatencyMs).toBe(9_000);
  });
});

/*
 * A real Duffel sandbox search, replayed offline.
 *
 * Recorded by `scripts/record-duffel.ts` and committed, redacted. It is the
 * evidence the live-provider readiness gate asks for: what Duffel actually
 * sends - two calls per search, local wall-clock times, a stated validity
 * window on every offer - checked against the adapter with no network.
 */
describe('a recorded Duffel search', () => {
  const cassette = loadCassette('duffel-round-trip');

  async function replay() {
    const provider = createDuffelFlightProvider({
      token: 'duffel_test_replay',
      fetchImpl: replayingFetch(cassette),
    });

    const created = JSON.parse(cassette.exchanges[0]!.request.body ?? '{}') as {
      data: { slices: { origin: string; destination: string; departure_date: string }[] };
    };
    const [out, back] = created.data.slices;

    return provider.searchFlights({
      origins: [out!.origin],
      destinations: [out!.destination],
      departureDate: out!.departure_date,
      returnDate: back!.departure_date,
      passengers: 1,
      currency: 'EUR',
    });
  }

  it('maps every recorded offer to one the domain boundary accepts', async () => {
    const result = await replay();
    if (!result.ok) throw new Error(result.error.message);

    expect(result.value.items.length).toBeGreaterThan(0);
    expect(validateOffers(flightOfferSchema, result.value.items).rejected).toEqual([]);
  });

  it('carries the validity window Duffel stated, thirty minutes after creation', async () => {
    const result = await replay();
    if (!result.ok) throw new Error(result.error.message);

    for (const offer of result.value.items) {
      expect(offer.expiresAt).not.toBeNull();
      const window = Date.parse(offer.expiresAt!) - Date.parse(offer.observedAt);
      expect(window).toBeGreaterThan(29 * 60_000);
      expect(window).toBeLessThan(31 * 60_000);
    }
  });

  it('keeps the times as local clock faces, with no zone', async () => {
    const result = await replay();
    if (!result.ok) throw new Error(result.error.message);

    for (const offer of result.value.items) {
      for (const segment of [...offer.outbound.segments, ...offer.inbound.segments]) {
        expect(segment.departsAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/);
      }
    }
  });
});
