import { describe, expect, it } from 'vitest';
import { flightOfferSchema, hotelOfferSchema, thingToDoSchema, validateOffers } from './schema';
import { createMockFlightProvider } from './flights/mock';
import { createMockHotelProvider } from './hotels/mock';

/**
 * What a provider is allowed to hand us.
 *
 * Every case here is one a deterministic mock cannot produce and a live
 * vendor can, which is the whole reason this layer exists.
 */

const wellFormedFlight = {
  id: 'f1',
  providerId: 'mock-flights',
  outbound: {
    segments: [
      {
        origin: 'VIE',
        destination: 'AYT',
        departsAt: '2026-06-10T08:00',
        arrivesAt: '2026-06-10T11:30',
        carrier: 'XX',
        flightNumber: 'XX100',
      },
    ],
    durationMinutes: 210,
    cabinBaggageIncluded: true,
    checkedBaggageIncluded: null,
    selfTransfer: false,
  },
  inbound: {
    segments: [
      {
        origin: 'AYT',
        destination: 'VIE',
        departsAt: '2026-06-15T12:00',
        arrivesAt: '2026-06-15T15:30',
        carrier: 'XX',
        flightNumber: 'XX101',
      },
    ],
    durationMinutes: 210,
    cabinBaggageIncluded: true,
    checkedBaggageIncluded: null,
    selfTransfer: false,
  },
  price: { amount: 24_900, currency: 'EUR' },
  observedAt: '2026-06-01T09:00:00Z',
  expiresAt: null,
};

const only = (value: unknown) => validateOffers(flightOfferSchema, [value]);

describe('flight offers from a provider', () => {
  it('accepts a vendor-stated expiry, and refuses an offer that omits the key', () => {
    expect(only({ ...wellFormedFlight, expiresAt: '2026-06-01T09:30:00Z' }).accepted).toHaveLength(
      1,
    );

    const { expiresAt: _omitted, ...withoutExpiry } = wellFormedFlight;
    expect(only(withoutExpiry).accepted).toHaveLength(0);
  });

  it('accepts a well-formed offer', () => {
    expect(only(wellFormedFlight).accepted).toHaveLength(1);
  });

  it('rejects a fractional amount, because minor units are whole', () => {
    /*
     * The limit of what a schema can catch, stated plainly: `249.5` is
     * obviously not minor units and is refused here, but a vendor sending
     * `249` meaning 249 euros is indistinguishable from 249 cents by
     * inspection alone. No validator can tell those apart - only the adapter
     * knows which unit its vendor quotes in, which is what `fromMajor` in
     * `money.ts` is for. This catches the detectable half.
     */
    const { accepted, rejected } = only({
      ...wellFormedFlight,
      price: { amount: 249.5, currency: 'EUR' },
    });

    expect(accepted).toHaveLength(0);
    expect(rejected[0]?.problems.join(' ')).toContain('integer');
  });

  it('rejects a null price rather than costing a trip at nothing', () => {
    expect(only({ ...wellFormedFlight, price: null }).accepted).toHaveLength(0);
  });

  it('rejects a negative price', () => {
    expect(
      only({ ...wellFormedFlight, price: { amount: -100, currency: 'EUR' } }).accepted,
    ).toHaveLength(0);
  });

  it('rejects a missing nullable field, because silence must be explicit', () => {
    // `null` means the vendor did not say. Absent means the adapter forgot to
    // map it, which is a bug rather than a silence worth honouring.
    const outbound: Record<string, unknown> = { ...wellFormedFlight.outbound };
    delete outbound.selfTransfer;

    expect(only({ ...wellFormedFlight, outbound }).accepted).toHaveLength(0);
  });

  it('accepts an explicit null for a fact the vendor did not state', () => {
    const outbound = { ...wellFormedFlight.outbound, selfTransfer: null };

    expect(only({ ...wellFormedFlight, outbound }).accepted).toHaveLength(1);
  });

  it('rejects a flight time claiming to be an instant', () => {
    // A flight time is the clock face at its airport. A trailing Z means the
    // vendor either converted it or mislabelled it, and we cannot tell which.
    const outbound = {
      ...wellFormedFlight.outbound,
      segments: [{ ...wellFormedFlight.outbound.segments[0], departsAt: '2026-06-10T08:00:00Z' }],
    };

    expect(only({ ...wellFormedFlight, outbound }).accepted).toHaveLength(0);
  });

  it('rejects an observation with no zone, because it is not an instant', () => {
    expect(only({ ...wellFormedFlight, observedAt: '2026-06-01T09:00:00' }).accepted).toHaveLength(
      0,
    );
  });

  it('rejects a leg with no segments', () => {
    const outbound = { ...wellFormedFlight.outbound, segments: [] };

    expect(only({ ...wellFormedFlight, outbound }).accepted).toHaveLength(0);
  });

  it('rejects an unexpected extra field rather than ignoring it', () => {
    // A field we do not know about may be the one carrying the real price.
    expect(only({ ...wellFormedFlight, surprisePrice: 1 }).accepted).toHaveLength(0);
  });

  it('rejects nonsense outright', () => {
    expect(validateOffers(flightOfferSchema, [null, 'a string', 42]).accepted).toHaveLength(0);
  });

  it('keeps the good offers and reports only the bad ones', () => {
    // Nineteen usable offers and one recorded issue beats no search at all.
    const { accepted, rejected } = validateOffers(flightOfferSchema, [
      wellFormedFlight,
      { ...wellFormedFlight, id: 'broken', price: null },
      { ...wellFormedFlight, id: 'f2' },
    ]);

    expect(accepted.map((offer) => offer.id)).toEqual(['f1', 'f2']);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.id).toBe('broken');
  });
});

describe('hotel offers from a provider', () => {
  const wellFormedHotel = {
    id: 'h1',
    providerId: 'mock-hotels',
    name: 'A Hotel',
    starRating: 4,
    reviewScore: 8.4,
    reviewCount: 120,
    distanceToBeachMetres: 300,
    distanceToCentreMetres: null,
    boardType: 'breakfast',
    freeCancellation: true,
    rooms: 1,
    photoUrls: null,
    position: null,
    area: null,
    totalPrice: { amount: 60_000, currency: 'EUR' },
    excludedFees: null,
    observedAt: '2026-06-01T09:00:00Z',
  };

  it('accepts a well-formed offer', () => {
    expect(validateOffers(hotelOfferSchema, [wellFormedHotel]).accepted).toHaveLength(1);
  });

  it('rejects a review score outside the normalised range', () => {
    // A vendor scoring out of 100 rather than 10 is a real and common shape,
    // and it would quietly dominate every ranking.
    expect(
      validateOffers(hotelOfferSchema, [{ ...wellFormedHotel, reviewScore: 84 }]).accepted,
    ).toHaveLength(0);
  });

  it('rejects a board type it does not recognise', () => {
    expect(
      validateOffers(hotelOfferSchema, [{ ...wellFormedHotel, boardType: 'brunch' }]).accepted,
    ).toHaveLength(0);
  });

  it('rejects a fractional review count', () => {
    expect(
      validateOffers(hotelOfferSchema, [{ ...wellFormedHotel, reviewCount: 12.5 }]).accepted,
    ).toHaveLength(0);
  });

  it('keeps an excluded fee, and refuses one that is not money', () => {
    expect(
      validateOffers(hotelOfferSchema, [
        { ...wellFormedHotel, excludedFees: { amount: 2_500, currency: 'EUR' } },
      ]).accepted,
    ).toHaveLength(1);

    expect(
      validateOffers(hotelOfferSchema, [{ ...wellFormedHotel, excludedFees: 25 }]).accepted,
    ).toHaveLength(0);
  });
});

describe('the deterministic mocks', () => {
  it('produce offers that pass the same validation a live vendor must', async () => {
    // If the mocks could not pass this, the boundary would be untested by
    // every other suite in the project.
    const flights = await createMockFlightProvider().searchFlights({
      origins: ['VIE'],
      destinations: ['AYT'],
      departureDate: '2026-06-10',
      returnDate: '2026-06-15',
      passengers: 2,
      currency: 'EUR',
      directOnly: false,
      maxResults: 5,
    });

    expect(flights.ok).toBe(true);
    if (flights.ok) {
      const { accepted, rejected } = validateOffers(flightOfferSchema, flights.value.items);
      expect(rejected).toEqual([]);
      expect(accepted.length).toBeGreaterThan(0);
    }

    const hotels = await createMockHotelProvider().searchHotels({
      destination: 'AYT',
      checkIn: '2026-06-10',
      checkOut: '2026-06-15',
      guests: 2,
      currency: 'EUR',
      maxResults: 5,
    });

    expect(hotels.ok).toBe(true);
    if (hotels.ok) {
      expect(validateOffers(hotelOfferSchema, hotels.value.items).rejected).toEqual([]);
    }
  });
});

describe('thingToDoSchema', () => {
  const place = {
    id: 'Q1283114',
    providerId: 'wikidata',
    name: "Hadrian's Gate",
    kind: 'sights',
    description: 'triumphal arch in Antalya',
    latitude: 36.8866,
    longitude: 30.7054,
    distanceFromCentreMetres: 2780,
    notability: 20,
    wikipediaUrl: 'https://en.wikipedia.org/wiki/Hadrian%27s_Gate',
    imageFile: 'Hadrian Kapısı (4).JPG',
  };

  const valid = (overrides: Record<string, unknown>) =>
    validateOffers(thingToDoSchema, [{ ...place, ...overrides }]);

  it('accepts a well-formed place, with every unstated fact as an explicit null', () => {
    expect(validateOffers(thingToDoSchema, [place]).rejected).toEqual([]);
    expect(
      validateOffers(thingToDoSchema, [
        { ...place, description: null, wikipediaUrl: null, imageFile: null },
      ]).accepted,
    ).toHaveLength(1);
  });

  it('rejects a fact that is missing rather than null', () => {
    for (const field of ['description', 'wikipediaUrl', 'imageFile']) {
      const { [field]: _omitted, ...without } = place as Record<string, unknown>;
      expect(validateOffers(thingToDoSchema, [without]).accepted, field).toEqual([]);
    }
  });

  it.each([
    ['an id that is not a Wikidata item', { id: 'place-1' }],
    ['an empty name', { name: '   ' }],
    ['a kind we do not have', { kind: 'nightlife' }],
    ['a latitude off the globe', { latitude: 91 }],
    ['a longitude off the globe', { longitude: -181 }],
    ['a distance that is not a whole number of metres', { distanceFromCentreMetres: 12.5 }],
    ['a negative distance', { distanceFromCentreMetres: -1 }],
    ['a link that is not Wikipedia', { wikipediaUrl: 'https://evil.example/wiki/X' }],
    ['a link that is not https', { wikipediaUrl: 'http://en.wikipedia.org/wiki/X' }],
    ['an image path', { imageFile: '../secret.jpg' }],
    ['an image that is a vector', { imageFile: 'plan.svg' }],
    ['an unknown field', { rating: 4.8 }],
  ])('rejects %s', (_label, overrides) => {
    expect(valid(overrides).accepted).toEqual([]);
  });
});
