import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createLimiter } from '@/lib/concurrency';
import { checkLiteApiPrice, type PriceCheckInput } from './liteapi-prebook';

const KEY = 'sand_test_key_123';

const input: PriceCheckInput = {
  hotelId: 'lp1',
  roomName: 'Double room',
  board: 'breakfast',
  refundable: true,
  query: {
    destination: { code: null, name: null, position: null, radiusKm: null },
    checkIn: '2027-03-10' as never,
    checkOut: '2027-03-13' as never,
    occupancy: { adults: 2, children: 0, rooms: 1 },
    currency: 'EUR',
  },
};

const ratesBody = {
  sandbox: true,
  data: [
    {
      hotelId: 'lp1',
      roomTypes: [
        {
          offerId: 'fresh-offer',
          offerRetailRate: { amount: 300, currency: 'EUR' },
          rates: [
            {
              rateId: 'r1',
              name: 'Double room',
              boardType: 'BB',
              retailRate: { total: [{ amount: 300, currency: 'EUR' }] },
              cancellationPolicies: { refundableTag: 'RFN' },
            },
          ],
        },
      ],
    },
  ],
};

const prebookBody = {
  data: {
    prebookId: 'p1',
    price: 312.5,
    currency: 'EUR',
    priceDifferencePercent: 0,
    cancellationChanged: false,
    boardChanged: false,
    roomTypes: [
      {
        rates: [
          {
            retailRate: {
              total: [{ amount: 312.5, currency: 'EUR' }],
              taxesAndFees: [
                { included: true, description: 'VAT', amount: 20, currency: 'EUR' },
                { included: false, description: 'City tax', amount: 6, currency: 'EUR' },
              ],
            },
          },
        ],
      },
    ],
  },
};

function fakeFetch(prebook: { status?: number; body?: unknown } = {}) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/hotels/rates')) return Response.json(ratesBody);
    if (url.endsWith('/rates/prebook')) {
      return Response.json(prebook.body ?? prebookBody, { status: prebook.status ?? 200 });
    }
    throw new Error(`unexpected call ${init?.method} ${url}`);
  });
}

const deps = (fetchImpl: ReturnType<typeof fakeFetch>) => ({
  apiKey: KEY,
  fetchImpl: fetchImpl as never,
  now: () => new Date('2027-01-10T09:30:00.000Z'),
  limiter: createLimiter(1),
});

describe('checkLiteApiPrice', () => {
  it('re-quotes, then prebooks the fresh offer id, and returns the vendor figures', async () => {
    const fetchImpl = fakeFetch();
    const result = await checkLiteApiPrice(input, deps(fetchImpl));

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0]![0]).toMatch(/\/hotels\/rates$/);
    expect(fetchImpl.mock.calls[1]![0]).toMatch(/\/rates\/prebook$/);
    expect(JSON.parse(String(fetchImpl.mock.calls[1]![1]?.body))).toEqual({
      offerId: 'fresh-offer',
      usePaymentSdk: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.total).toEqual({ amount: 31250, currency: 'EUR' });
    expect(result.value.taxesIncluded).toEqual({ amount: 2000, currency: 'EUR' });
    expect(result.value.payableAtHotel).toEqual({ amount: 600, currency: 'EUR' });
    expect(result.value.checkedAt).toBe('2027-01-10T09:30:00.000Z');
    expect(result.value.changed).toBe(false);
    expect(result.value.testPrices).toBe(true);
  });

  it('never calls book, and sends the key only as a header', async () => {
    const fetchImpl = fakeFetch();
    await checkLiteApiPrice(input, deps(fetchImpl));

    for (const call of fetchImpl.mock.calls) {
      expect(call[0]).not.toMatch(/\/rates\/book/);
      expect(String(call[1]?.body)).not.toContain(KEY);
    }
  });

  it('makes no prebook call when the fresh quote no longer has that rate', async () => {
    const fetchImpl = fakeFetch();
    const result = await checkLiteApiPrice({ ...input, roomName: 'Suite' }, deps(fetchImpl));

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
  });

  it('reports a changed rate when the vendor substituted one', async () => {
    const changed = { data: { ...prebookBody.data, priceDifferencePercent: 4 } };
    const result = await checkLiteApiPrice(input, deps(fakeFetch({ body: changed })));

    expect(result.ok && result.value.changed).toBe(true);
  });

  it('turns a prebook error status into an error result without the key in the message', async () => {
    const result = await checkLiteApiPrice(input, deps(fakeFetch({ status: 408, body: {} })));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('PROVIDER_UNAVAILABLE');
    expect(result.error.message).not.toContain(KEY);
  });

  it('rejects an unrecognised prebook body as an error', async () => {
    const result = await checkLiteApiPrice(input, deps(fakeFetch({ body: { data: {} } })));

    expect(result.ok).toBe(false);
  });

  it('fails closed without a key', async () => {
    const result = await checkLiteApiPrice(input, { apiKey: '' });

    expect(result.ok).toBe(false);
  });

  it('does not import the refresh job and does not name the book endpoint', () => {
    const source = readFileSync(`${__dirname}/liteapi-prebook.ts`, 'utf8');

    expect(source).not.toMatch(/liteapi-snapshot/);
    expect(source).not.toMatch(/rates\/book/);
    expect(source).not.toMatch(/process\.env/);
  });
});
