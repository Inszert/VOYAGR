import { describe, expect, it, vi } from 'vitest';
import type { StayQuery } from '@/core/stay/types';
import hotelsFixture from '../../../tests/fixtures/providers/liteapi/data-hotels-lisbon.json';
import ratesFixture from '../../../tests/fixtures/providers/liteapi/hotels-rates-lisbon.json';
import { liteapiHotelRowSchema, liteapiRatesRowSchema } from '../schema';
import { SECRET_ENV_KEYS } from '@/lib/env';
import { createLiteApiStayProvider, LiteApiStayProvider, toMoney } from './liteapi';
import { getStayProviders, resetStayProviders } from './registry';

/*
 * Fixtures are written from the documented response shapes, not recorded:
 * no live call was made. No test here touches the network.
 */

const query: StayQuery = {
  destination: {
    code: 'LIS',
    name: 'Lisbon',
    position: { latitude: 38.72, longitude: -9.14 },
    radiusKm: 5,
  },
  checkIn: '2027-03-10',
  checkOut: '2027-03-13',
  occupancy: { adults: 2, children: 0, rooms: 1 },
  currency: 'EUR',
};

function fakeFetch(rates: unknown = ratesFixture, ratesStatus = 200) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.includes('/data/hotels')) return Response.json(hotelsFixture);
    return Response.json(rates, { status: ratesStatus });
  });
  return { fetchImpl, calls };
}

const NOW = () => new Date('2027-01-01T10:00:00Z');

describe('LiteAPI stays adapter', () => {
  it('prices a hotel with the vendor total, in minor units, and sorts cheapest first', async () => {
    const { fetchImpl, calls } = fakeFetch();
    const provider = new LiteApiStayProvider({ apiKey: 'k', fetchImpl, now: NOW });

    const result = await provider.searchStays(query);
    if (!result.ok) throw result.error;

    const priced = result.value.find((o) => o.property.providerPropertyId === 'lp1001')!;
    expect(priced.rates.map((r) => r.providerRateId)).toEqual([
      'offer-room-only',
      'offer-breakfast',
    ]);
    expect(priced.rates[0]!.total).toEqual({ amount: 33333, currency: 'EUR' });
    expect(priced.rates[0]!.perNight).toEqual({ amount: 11111, currency: 'EUR' });
    expect(priced.rates[0]!.board).toBe('room_only');
    expect(priced.rates[0]!.cancellation.refundable).toBe(true);
    expect(priced.rates[1]!.cancellation.refundable).toBe(false);
    // The rates response says sandbox: it is test data, never live.
    expect(priced.rates[0]!.source.provenance).toBe('test');
    expect(priced.rates[0]!.observedAt).toBe('2027-01-01T10:00:00.000Z');

    const list = new URL(calls[0]!.url);
    expect(list.origin + list.pathname).toBe('https://api.liteapi.travel/v3.0/data/hotels');
    expect(list.searchParams.get('radius')).toBe('5000');
    const body = JSON.parse(String(calls[1]!.init?.body));
    expect(body).toMatchObject({
      checkin: '2027-03-10',
      checkout: '2027-03-13',
      currency: 'EUR',
      occupancies: [{ adults: 2 }],
    });
    expect(new Headers(calls[1]!.init?.headers).get('x-api-key')).toBe('k');
  });

  it('shows no price for a hotel the vendor quoted nothing for', async () => {
    const { fetchImpl } = fakeFetch();
    const result = await new LiteApiStayProvider({ apiKey: 'k', fetchImpl }).searchStays(query);
    if (!result.ok) throw result.error;

    const unpriced = result.value.find((o) => o.property.providerPropertyId === 'lp1002')!;
    expect(unpriced.rates).toEqual([]);
    // Stars 0 and rating 0 mean "not stated", not a zero rating.
    expect(unpriced.property.starRating).toBeNull();
    expect(unpriced.property.guestRating).toBeNull();
  });

  it('keeps https photos only and drops a malformed hotel row', async () => {
    const { fetchImpl } = fakeFetch();
    const result = await new LiteApiStayProvider({ apiKey: 'k', fetchImpl }).searchStays(query);
    if (!result.ok) throw result.error;

    expect(result.value.map((o) => o.property.providerPropertyId)).toEqual(['lp1001', 'lp1002']);
    expect(result.value[0]!.property.photos).toEqual([
      { url: 'https://static.example.test/lp1001.jpg', caption: null },
    ]);
    expect(result.value[1]!.property.photos).toEqual([]);
  });

  it('lists hotels unpriced when the rates call fails', async () => {
    const { fetchImpl } = fakeFetch({}, 500);
    const result = await new LiteApiStayProvider({ apiKey: 'k', fetchImpl }).searchStays(query);
    if (!result.ok) throw result.error;

    expect(result.value).toHaveLength(2);
    expect(result.value.every((o) => o.rates.length === 0)).toBe(true);
  });

  it('does not call the vendor for a party with children or a query with no position', async () => {
    const { fetchImpl } = fakeFetch();
    const provider = new LiteApiStayProvider({ apiKey: 'k', fetchImpl });

    await provider.searchStays({ ...query, occupancy: { adults: 2, children: 1, rooms: 1 } });
    await provider.searchStays({ ...query, destination: { ...query.destination, position: null } });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('LiteAPI schema boundary', () => {
  it('rejects a hotel row with no coordinates', () => {
    expect(liteapiHotelRowSchema.safeParse(hotelsFixture.data[2]).success).toBe(false);
    expect(liteapiHotelRowSchema.safeParse(hotelsFixture.data[0]).success).toBe(true);
  });

  it('rejects a rate whose amount is a string', () => {
    expect(liteapiRatesRowSchema.safeParse(ratesFixture.data[2]).success).toBe(false);
    expect(liteapiRatesRowSchema.safeParse(ratesFixture.data[0]).success).toBe(true);
  });

  it('parses vendor decimals to exact minor units', () => {
    expect(toMoney(163.66, 'USD')).toEqual({ amount: 16366, currency: 'USD' });
    expect(toMoney(0.1 + 0.2, 'EUR')).toEqual({ amount: 30, currency: 'EUR' });
    expect(toMoney(1500, 'JPY')).toEqual({ amount: 1500, currency: 'JPY' });
    expect(toMoney(10, 'EU')).toBeNull();
  });
});

describe('LiteAPI is absent without a key', () => {
  it('builds nothing when LITEAPI_API_KEY is unset', () => {
    expect(createLiteApiStayProvider({ LITEAPI_API_KEY: undefined })).toBeNull();
    expect(createLiteApiStayProvider({ LITEAPI_API_KEY: 'k' })?.metadata.id).toBe('liteapi');
  });

  it('is not registered unless named and keyed, and the key is a secret', () => {
    resetStayProviders();
    const base = { STAY_PROVIDERS: 'liteapi,absent' } as never;
    const without = getStayProviders(base, 'api').map((p) => p.metadata.id);
    expect(without).not.toContain('liteapi');

    resetStayProviders();
    const withKey = getStayProviders({ STAY_PROVIDERS: 'liteapi', LITEAPI_API_KEY: 'k' } as never);
    expect(withKey.map((p) => p.metadata.id)).toEqual(['liteapi']);
    resetStayProviders();

    expect(SECRET_ENV_KEYS).toContain('LITEAPI_API_KEY');
  });
});
