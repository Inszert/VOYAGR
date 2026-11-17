import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The email verification link lands a visitor somewhere that says what happened.
 *
 * A confirmed address goes to the confirmation page. A rejected or missing
 * token stays on the account page with its flag, as it always has.
 */

const verifyEmail = vi.fn();

vi.mock('@/auth/current-user', () => ({
  getAuthService: () => ({ verifyEmail }),
}));

const logger = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }));
vi.mock('@/lib/logger', () => ({ getLogger: () => logger }));

const { GET } = await import('./route');
const { AppError } = await import('@/lib/errors');

const get = (query: string) => GET(new Request(`https://voyagr.test/api/verify-email${query}`));

describe('GET /api/verify-email', () => {
  beforeEach(() => {
    verifyEmail.mockReset();
    logger.warn.mockReset();
  });

  it('sends a confirmed address to the confirmation page', async () => {
    verifyEmail.mockResolvedValue(undefined);

    const response = await get('?token=abc');

    expect(verifyEmail).toHaveBeenCalledWith('abc');
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get('location')!).pathname).toBe('/email-confirmed');
    expect(new URL(response.headers.get('location')!).search).toBe('');
  });

  it('keeps a rejected link on the account page with the invalid flag', async () => {
    verifyEmail.mockRejectedValue(new AppError('VALIDATION_ERROR', 'Unknown verification token'));

    const response = await get('?token=stale');

    const target = new URL(response.headers.get('location')!);
    expect(target.pathname).toBe('/account');
    expect(target.search).toBe('?verified=invalid');
  });

  it('keeps a link with no token on the account page with the missing-token flag', async () => {
    const response = await get('');

    expect(verifyEmail).not.toHaveBeenCalled();
    const target = new URL(response.headers.get('location')!);
    expect(target.pathname).toBe('/account');
    expect(target.search).toBe('?verified=missing-token');
  });
});
