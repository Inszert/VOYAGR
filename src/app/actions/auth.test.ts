import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Sign-up's redirect says whether the verification email went out.
 *
 * The sign-up page sends any signed-in visitor to the account, so the action
 * cannot answer with a message on the form; the account page reads the flag.
 */

const register = vi.fn();
const redirect = vi.fn((to: string) => {
  throw Object.assign(new Error('NEXT_REDIRECT'), { to });
});

vi.mock('next/navigation', () => ({ redirect: (to: string) => redirect(to) }));
vi.mock('@/auth/current-user', () => ({
  getAuthService: () => ({ register }),
  setSessionCookie: vi.fn(async () => {}),
  clearSessionCookie: vi.fn(),
  getCurrentUser: vi.fn(),
  getSessionToken: vi.fn(),
}));
vi.mock('@/db', () => ({ getRepositories: vi.fn() }));
vi.mock('@/lib/client-key', () => ({ resolveClientKey: vi.fn(async () => 'test') }));

const { signUpAction } = await import('./auth');

const form = () => {
  const data = new FormData();
  data.set('email', 'a@example.com');
  data.set('password', 'a long enough password');
  return data;
};

const issued = (verificationEmailSent: boolean) => ({
  user: { id: 'u1' },
  token: 't',
  expiresAt: '2026-12-01T00:00:00Z',
  verificationEmailSent,
});

describe('signUpAction', () => {
  beforeEach(() => {
    register.mockReset();
    redirect.mockClear();
  });

  it('goes to the account page when the verification email was sent', async () => {
    register.mockResolvedValue(issued(true));
    await expect(signUpAction({}, form())).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/account');
  });

  it('says so on the account page when the account exists but the mail did not go out', async () => {
    register.mockResolvedValue(issued(false));
    await expect(signUpAction({}, form())).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/account?verification=unsent');
  });
});
