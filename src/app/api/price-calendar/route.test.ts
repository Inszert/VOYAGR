import { beforeEach, describe, expect, it, vi } from 'vitest';

const searchFlights = vi.fn();
let clientKey = 'client-a';

vi.mock('@/lib/client-key', () => ({ resolveClientKey: async () => clientKey }));
vi.mock('@/providers/request-source', () => ({
  getActiveDataSource: async () => ({ effective: 'mock' }),
}));
vi.mock('@/providers/registry', () => ({
  getProviderRegistry: () => ({
    flights: {
      metadata: { id: 'stub', rateLimitPerMinute: 600, answersByMonth: true },
      searchFlights,
    },
  }),
}));

import { GET } from './route';

const NOW = new Date('2026-11-15T10:00:00Z');

function call(query: Record<string, string>) {
  const params = new URLSearchParams({
    origin: 'VIE',
    destinations: 'AYT',
    month: '2026-12',
    currency: 'EUR',
    ...query,
  });
  return GET(new Request(`http://localhost/api/price-calendar?${params}`));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  searchFlights.mockReset();
  searchFlights.mockResolvedValue({ ok: true, value: { items: [] } });
  globalThis.__voyagrPriceCalendarClients = undefined;
  globalThis.__voyagrDayPriceBudget = undefined;
  clientKey = 'client-a';
});

describe('GET /api/price-calendar', () => {
  it('refuses a month already over or beyond a year out, before any provider call', async () => {
    expect((await call({ month: '2026-10' })).status).toBe(400);
    expect((await call({ month: '2027-12' })).status).toBe(400);
    expect((await call({ month: '9999-01' })).status).toBe(400);
    expect(searchFlights).not.toHaveBeenCalled();
  });

  it('accepts this month and the month a year out', async () => {
    expect((await call({ month: '2026-11' })).status).toBe(200);
    expect((await call({ month: '2027-11', origin: 'GRZ' })).status).toBe(200);
  });

  it('refuses malformed input without calling a provider', async () => {
    expect((await call({ origin: 'VIENNA' })).status).toBe(400);
    expect((await call({ destinations: 'AYT,BCN,PMI,MAD,LIS,FCO' })).status).toBe(400);
    expect((await call({ passengers: '99' })).status).toBe(400);
    expect(searchFlights).not.toHaveBeenCalled();
  });

  it('answers 429 with Retry-After once one client passes its per-minute allowance', async () => {
    let last: Response | undefined;
    for (let i = 0; i < 61; i++) last = await call({ month: '2026-12' });

    expect(last?.status).toBe(429);
    expect(Number(last?.headers.get('Retry-After'))).toBeGreaterThan(0);
    // A different client is not affected.
    clientKey = 'client-b';
    expect((await call({})).status).toBe(200);
  });

  it('serves repeats from the cache: a flood of one query is one load', async () => {
    for (let i = 0; i < 20; i++) await call({ origin: 'ZRH' });
    // answersByMonth asks two questions per destination, once.
    expect(searchFlights.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('never calls the provider for more than the shared load budget, however the query varies', async () => {
    const origins = Array.from({ length: 200 }, (_, i) => {
      const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      return `${a[Math.floor(i / 26)]}${a[i % 26]}X`;
    });

    for (const [index, origin] of origins.entries()) {
      clientKey = `client-${index}`; // spoofed forwarded addresses: per-client limits do not help
      await call({ origin });
    }

    // 120 loads x 2 questions each, and not one more.
    expect(searchFlights.mock.calls.length).toBeLessThanOrEqual(240);
  });
});
