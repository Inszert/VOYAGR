import { describe, expect, it, vi } from 'vitest';
import { LiteApiFlightsClient, mapJourney } from './liteapi';

const OBSERVED = '2027-01-10T12:00:00.000Z';

const segment = (overrides: Record<string, unknown> = {}) => ({
  originCode: 'VIE',
  destinationCode: 'LIS',
  departureTime: '2027-02-09T16:10:00',
  arrivalTime: '2027-02-09T18:55:00',
  direction: 'OUTBOUND',
  carrier: { marketingCode: 'TP' },
  flight: { marketingNumber: '1234' },
  ...overrides,
});

const offer = (overrides: Record<string, unknown> = {}) => ({
  offerId: 'o1',
  expiration: '2027-01-10T12:30:00.000Z',
  pricing: { display: { total: 412.5, currency: 'EUR' } },
  baggage: { hasCarryOnBag: true, hasCheckedBag: false },
  ...overrides,
});

const journey = (overrides: Record<string, unknown> = {}) => ({
  journeyKey: 'j1',
  segments: [
    segment(),
    segment({
      originCode: 'LIS',
      destinationCode: 'VIE',
      departureTime: '2027-02-13T10:00:00',
      arrivalTime: '2027-02-13T14:30:00',
      direction: 'INBOUND',
    }),
  ],
  legDurations: [
    { direction: 'OUTBOUND', duration: { minutes: 225 } },
    { direction: 'INBOUND', duration: { minutes: 210 } },
  ],
  offers: [
    offer({ offerId: 'dear', pricing: { display: { total: 999, currency: 'EUR' } } }),
    offer(),
  ],
  ...overrides,
});

describe('mapJourney', () => {
  it('maps a round trip to two legs with the vendor durations and an exact Money total', () => {
    const result = mapJourney(journey(), 'EUR', OBSERVED);

    expect('offer' in result).toBe(true);
    if (!('offer' in result)) return;
    expect(result.offer.price).toEqual({ amount: 41250, currency: 'EUR' });
    expect(result.offer.id).toBe('liteapi:o1');
    expect(result.offer.outbound.durationMinutes).toBe(225);
    expect(result.offer.inbound.durationMinutes).toBe(210);
    expect(result.offer.outbound.segments[0]).toMatchObject({
      origin: 'VIE',
      departsAt: '2027-02-09T16:10:00',
      flightNumber: 'TP1234',
    });
    expect(result.offer.outbound.cabinBaggageIncluded).toBe(true);
    expect(result.offer.outbound.checkedBaggageIncluded).toBe(false);
    expect(result.offer.expiresAt).toBe('2027-01-10T12:30:00.000Z');
    expect(result.offer.observedAt).toBe(OBSERVED);
  });

  it('leaves unstated baggage as null, never false', () => {
    const result = mapJourney(
      journey({ offers: [offer({ baggage: undefined })] }),
      'EUR',
      OBSERVED,
    );
    expect('offer' in result && result.offer.outbound.checkedBaggageIncluded).toBeNull();
  });

  it.each([
    ['a zoned segment time', { departureTime: '2027-02-09T16:10:00Z' }],
    ['no direction', { direction: undefined }],
  ])('drops a journey with %s', (_name, change) => {
    const base = journey();
    const result = mapJourney(
      { ...base, segments: [segment(change), base.segments[1]] },
      'EUR',
      OBSERVED,
    );
    expect('reason' in result).toBe(true);
  });

  it('drops a journey with no leg duration, and one priced in another currency', () => {
    expect('reason' in mapJourney(journey({ legDurations: [] }), 'EUR', OBSERVED)).toBe(true);
    expect('reason' in mapJourney(journey(), 'GBP', OBSERVED)).toBe(true);
  });

  it('treats an expiry with no zone as unstated', () => {
    const result = mapJourney(
      journey({ offers: [offer({ expiration: '2027-01-10T12:30:00' })] }),
      'EUR',
      OBSERVED,
    );
    expect('offer' in result && result.offer.expiresAt).toBeNull();
  });
});

describe('LiteApiFlightsClient', () => {
  const query = {
    origin: 'LON',
    destination: 'LIS',
    departureDate: '2027-02-09',
    returnDate: '2027-02-13',
    adults: 2,
    currency: 'EUR',
    cabin: 'ECONOMY',
  };

  it('sends one documented round-trip request, and drops a malformed journey, cheapest first', async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) =>
      Response.json({
        data: [
          {
            journeys: [
              journey({ journeyKey: 'a', offers: [offer({ offerId: 'x' })] }),
              { nonsense: true },
              journey({
                journeyKey: 'b',
                offers: [
                  offer({ offerId: 'y', pricing: { display: { total: 100, currency: 'EUR' } } }),
                ],
              }),
            ],
          },
        ],
      }),
    );
    const client = new LiteApiFlightsClient({
      apiKey: 'sand_k',
      fetchImpl: fetchImpl as never,
      now: () => new Date(OBSERVED),
    });

    const result = await client.fetchOffers(query);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://api.liteapi.travel/v3.0/flights/rates');
    const body = JSON.parse(init!.body as string);
    expect(body).toMatchObject({
      adults: 2,
      currency: 'EUR',
      cabinClass: 'ECONOMY',
      legs: [
        { origin: 'LON', destination: 'LIS', date: '2027-02-09', direction: 'OUTBOUND' },
        { origin: 'LIS', destination: 'LON', date: '2027-02-13', direction: 'INBOUND' },
      ],
    });
    expect(body.margin).toBeUndefined();
    expect(result.ok && result.value.map((entry) => entry.id)).toEqual(['liteapi:y', 'liteapi:x']);
  });

  it('turns a 403 into a provider-unavailable result without the key in the message', async () => {
    const client = new LiteApiFlightsClient({
      apiKey: 'sand_secret',
      fetchImpl: (async () => new Response('no', { status: 403 })) as never,
    });

    const result = await client.fetchOffers(query);

    expect(!result.ok && result.error.code).toBe('PROVIDER_UNAVAILABLE');
    expect(!result.ok && result.error.message).not.toContain('sand_secret');
  });
});
