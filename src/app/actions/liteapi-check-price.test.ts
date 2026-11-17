import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  user: null as { id: string } | null,
  cookieValue: undefined as string | undefined,
  check: vi.fn(),
  apiKey: 'sand_key' as string | undefined,
}));

vi.mock('@/auth/current-user', () => ({ getCurrentUser: async () => mocks.user }));
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: () => (mocks.cookieValue ? { value: mocks.cookieValue } : undefined),
    set: (_name: string, value: string) => {
      mocks.cookieValue = value;
    },
  }),
}));
vi.mock('@/booking/liteapi-prebook', () => ({ checkLiteApiPrice: mocks.check }));
vi.mock('@/lib/env', () => ({
  getEnv: () => ({ LITEAPI_API_KEY: mocks.apiKey, NODE_ENV: 'test' }),
}));

import { checkPriceAction, PRICE_CHECKS_PER_WINDOW } from './liteapi-check-price';

const input = {
  hotelId: 'lp1',
  checkIn: '2027-03-10',
  checkOut: '2027-03-13',
  adults: 2,
  rooms: 1,
  currency: 'EUR',
  roomName: 'Double room',
  board: 'breakfast' as const,
  refundable: true,
};

const good = {
  total: { amount: 31250, currency: 'EUR' },
  taxesIncluded: null,
  payableAtHotel: null,
  checkedAt: '2027-01-10T09:30:00.000Z',
  changed: false,
  testPrices: false,
};

beforeEach(() => {
  mocks.user = null;
  mocks.cookieValue = undefined;
  mocks.apiKey = 'sand_key';
  mocks.check.mockReset();
  mocks.check.mockResolvedValue({ ok: true, value: good });
});

describe('checkPriceAction', () => {
  it('returns the checked price', async () => {
    const result = await checkPriceAction(input);

    expect(result).toEqual({ status: 'ok', check: good });
  });

  it('stops at the limit with a plain message and makes no further call', async () => {
    mocks.user = { id: 'limit-user' };
    for (let i = 0; i < PRICE_CHECKS_PER_WINDOW; i++) {
      expect((await checkPriceAction(input)).status).toBe('ok');
    }
    mocks.check.mockClear();

    const result = await checkPriceAction(input);

    expect(result.status).toBe('limited');
    expect(mocks.check).not.toHaveBeenCalled();
  });

  it('counts a signed-in user and a different user separately', async () => {
    mocks.user = { id: 'user-a' };
    for (let i = 0; i < PRICE_CHECKS_PER_WINDOW; i++) await checkPriceAction(input);
    expect((await checkPriceAction(input)).status).toBe('limited');

    mocks.user = { id: 'user-b' };
    expect((await checkPriceAction(input)).status).toBe('ok');
  });

  it('keys an anonymous visitor by a session cookie it sets', async () => {
    await checkPriceAction(input);

    expect(mocks.cookieValue).toBeTruthy();
  });

  it('refuses bad input before any call or count', async () => {
    const result = await checkPriceAction({ ...input, checkOut: '2027-03-01' });

    expect(result.status).toBe('failed');
    expect(mocks.check).not.toHaveBeenCalled();
  });

  it('fails plainly without a key and calls nothing', async () => {
    mocks.apiKey = undefined;

    expect((await checkPriceAction(input)).status).toBe('failed');
    expect(mocks.check).not.toHaveBeenCalled();
  });

  it('passes an expected failure on as a message, not a throw', async () => {
    mocks.user = { id: 'fail-user' };
    mocks.check.mockResolvedValue({
      ok: false,
      error: { code: 'X', publicMessage: 'No longer offered.' },
    });

    expect(await checkPriceAction(input)).toEqual({
      status: 'failed',
      message: 'No longer offered.',
    });
  });
});
