import { describe, expect, it } from 'vitest';
import { aviasalesSearchUrl, type AviasalesSearchInput } from './aviasales-search';

const trip: AviasalesSearchInput = {
  origin: 'VIE',
  destination: 'KZN',
  departureDate: '2026-11-25',
  returnDate: '2026-12-02',
  passengers: 1,
};

describe('aviasalesSearchUrl', () => {
  it('builds the search path the vendor uses for its own fare links', () => {
    // VIE 25 Nov, KZN back 2 Dec, one passenger.
    expect(aviasalesSearchUrl(trip)).toBe('https://www.aviasales.com/search/VIE2511KZN02121');
  });

  it('matches a path recorded in the Travelpayouts fixtures', () => {
    // `/search/VIE1112FCO12121` is a real price.link: Vienna out 11 Dec, Rome
    // back 12 Dec, one passenger. The builder must reproduce it exactly.
    expect(
      aviasalesSearchUrl({
        origin: 'VIE',
        destination: 'FCO',
        departureDate: '2026-12-11',
        returnDate: '2026-12-12',
        passengers: 1,
      }),
    ).toBe('https://www.aviasales.com/search/VIE1112FCO12121');
  });

  it('puts the passenger count last, for the top of the range too', () => {
    expect(aviasalesSearchUrl({ ...trip, passengers: 9 })).toBe(
      'https://www.aviasales.com/search/VIE2511KZN02129',
    );
  });

  it('accepts a return on the same day as the departure', () => {
    expect(aviasalesSearchUrl({ ...trip, returnDate: trip.departureDate })).toBe(
      'https://www.aviasales.com/search/VIE2511KZN25111',
    );
  });

  describe('invalid airport codes', () => {
    it.each([
      ['lower case origin', { origin: 'vie' }],
      ['four letters', { origin: 'VIEN' }],
      ['two letters', { origin: 'VI' }],
      ['digits', { origin: 'V1E' }],
      ['empty origin', { origin: '' }],
      ['whitespace', { origin: ' VIE' }],
      ['lower case destination', { destination: 'kzn' }],
      ['empty destination', { destination: '' }],
      ['same airport both ways', { destination: 'VIE' }],
    ])('returns null for %s', (_label, change) => {
      expect(aviasalesSearchUrl({ ...trip, ...change })).toBeNull();
    });
  });

  describe('invalid dates', () => {
    it.each([
      ['an impossible day', { departureDate: '2026-02-30' }],
      ['a day past the month end', { returnDate: '2026-04-31' }],
      ['a two-digit year', { departureDate: '26-11-25' }],
      ['slashes', { departureDate: '2026/11/25' }],
      ['a timestamp', { departureDate: '2026-11-25T00:00:00Z' }],
      ['an empty date', { departureDate: '' }],
      ['a non-date', { returnDate: 'next tuesday' }],
      ['a return before the departure', { returnDate: '2026-11-20' }],
    ])('returns null for %s', (_label, change) => {
      expect(aviasalesSearchUrl({ ...trip, ...change })).toBeNull();
    });

    it('accepts a leap day', () => {
      expect(
        aviasalesSearchUrl({
          ...trip,
          departureDate: '2028-02-28',
          returnDate: '2028-02-29',
        }),
      ).toBe('https://www.aviasales.com/search/VIE2802KZN29021');
    });
  });

  describe('passenger range', () => {
    it.each([0, -1, 10, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
      'returns null for %s passengers',
      (passengers) => {
        expect(aviasalesSearchUrl({ ...trip, passengers })).toBeNull();
      },
    );

    it.each([1, 2, 9])('accepts %s passengers', (passengers) => {
      expect(aviasalesSearchUrl({ ...trip, passengers })).not.toBeNull();
    });
  });

  describe('partner marker', () => {
    it('carries no marker when none is configured', () => {
      const url = aviasalesSearchUrl(trip);
      expect(url).not.toContain('marker');
      expect(new URL(url!).searchParams.has('marker')).toBe(false);
    });

    it.each([undefined, null, ''])('treats %j as no marker', (marker) => {
      expect(aviasalesSearchUrl({ ...trip, marker })).toBe(
        'https://www.aviasales.com/search/VIE2511KZN02121',
      );
    });

    it('adds the configured marker as a query parameter', () => {
      const url = aviasalesSearchUrl({ ...trip, marker: '780591' });
      expect(url).toBe('https://www.aviasales.com/search/VIE2511KZN02121?marker=780591');
    });

    it.each(['78 0591', 'abc&x=1', '../evil', 'a'.repeat(33)])(
      'returns null rather than drop a malformed marker (%s)',
      (marker) => {
        expect(aviasalesSearchUrl({ ...trip, marker })).toBeNull();
      },
    );
  });

  it('returns null for input that is not an object', () => {
    expect(aviasalesSearchUrl(null as unknown as AviasalesSearchInput)).toBeNull();
    expect(aviasalesSearchUrl('VIE' as unknown as AviasalesSearchInput)).toBeNull();
  });
});
