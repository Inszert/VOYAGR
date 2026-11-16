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

const logger = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }));
vi.mock('@/lib/logger', () => ({ getLogger: () => logger }));

const { signUpAction } = await import('./auth');
const { AppError } = await import('@/lib/errors');

const EMAIL = 'a@example.com';
const PASSWORD = 'a long enough password';

const form = () => {
  const data = new FormData();
  data.set('email', EMAIL);
  data.set('password', PASSWORD);
  return data;
};

const issued = (verificationEmailSent: boolean, verificationEmailFailure: unknown = null) => ({
  user: { id: 'u1' },
  token: 't',
  expiresAt: '2026-12-01T00:00:00Z',
  verificationEmailSent,
  verificationEmailFailure,
});

/** Everything the logger was handed, flattened to text, for "must not appear" checks. */
const everythingLogged = () =>
  JSON.stringify([
    ...logger.error.mock.calls,
    ...logger.warn.mock.calls,
    ...logger.info.mock.calls,
  ]);

describe('signUpAction', () => {
  beforeEach(() => {
    register.mockReset();
    redirect.mockClear();
    logger.error.mockReset();
    logger.warn.mockReset();
    logger.info.mockReset();
  });

  it('goes to the account page when the verification email was sent, and logs nothing', async () => {
    register.mockResolvedValue(issued(true));
    await expect(signUpAction({}, form())).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/account');
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('says so on the account page when the account exists but the mail did not go out', async () => {
    register.mockResolvedValue(
      issued(
        false,
        new AppError('CONFIGURATION_ERROR', 'RESEND_API_KEY missing', {
          publicMessage: 'Email delivery is not configured.',
          context: { provider: 'resend' },
        }),
      ),
    );
    await expect(signUpAction({}, form())).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/account?verification=unsent');
  });

  it('logs one warn line naming the reason when the account was created but the mail was not sent', async () => {
    register.mockResolvedValue(
      issued(
        false,
        new AppError(
          'CONFIGURATION_ERROR',
          'EMAIL_PROVIDER=console is not allowed in production: no email would be delivered.',
        ),
      ),
    );
    await expect(signUpAction({}, form())).rejects.toThrow('NEXT_REDIRECT');

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      {
        reason: 'VERIFICATION_EMAIL_NOT_SENT',
        code: 'CONFIGURATION_ERROR',
        message: expect.stringContaining('EMAIL_PROVIDER=console'),
      },
      expect.stringMatching(
        /^Account created, but the verification email was not sent: EMAIL_PROVIDER=console/,
      ),
    );
    expect(logger.error).not.toHaveBeenCalled();
    expect(everythingLogged()).not.toContain(EMAIL);
  });

  it('logs one error line with DATABASE_UNREACHABLE and returns the unchanged generic message', async () => {
    const refused = Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:5432'), {
      code: 'ECONNREFUSED',
    });
    register.mockRejectedValue(
      new AppError('INTERNAL_ERROR', 'Database query failed', {
        cause: refused,
        context: { sql: 'SELECT 1' },
      }),
    );

    const result = await signUpAction({}, form());

    // The visitor sees the AppError's own public message, exactly as before this change.
    expect(result).toEqual({ error: 'Something went wrong.', email: EMAIL });
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      {
        reason: 'DATABASE_UNREACHABLE',
        code: 'INTERNAL_ERROR',
        message: 'connect ECONNREFUSED 10.0.0.5:5432',
      },
      'Could not create the account: the database could not be reached.',
    );
    expect(redirect).not.toHaveBeenCalled();
  });

  it('returns the AppError public message unchanged for a validation failure, and logs VALIDATION', async () => {
    register.mockRejectedValue(
      new AppError('VALIDATION_ERROR', 'Implausible email address', {
        publicMessage: 'Enter a valid email address.',
      }),
    );

    const result = await signUpAction({}, form());

    expect(result).toEqual({ error: 'Enter a valid email address.', email: EMAIL });
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      { reason: 'VALIDATION', code: 'VALIDATION_ERROR', message: 'Implausible email address' },
      expect.any(String),
    );
  });

  it('never logs the address or the password, even when the driver quotes the address in its message', async () => {
    register.mockRejectedValue(
      new AppError('CONFLICT', `A user already exists with email ${EMAIL}`, {
        publicMessage: 'An account with that email already exists.',
      }),
    );

    const result = await signUpAction({}, form());

    expect(result).toEqual({ error: 'An account with that email already exists.', email: EMAIL });
    expect(logger.error).toHaveBeenCalledWith(
      {
        reason: 'EMAIL_ALREADY_REGISTERED',
        code: 'CONFLICT',
        message: 'A user already exists with email [email]',
      },
      expect.any(String),
    );
    expect(everythingLogged()).not.toContain(EMAIL);
    expect(everythingLogged()).not.toContain(PASSWORD);
  });

  it('logs an unexpected error as UNKNOWN with the generic visitor message', async () => {
    register.mockRejectedValue(new TypeError('x is not a function'));

    const result = await signUpAction({}, form());

    expect(result).toEqual({ error: 'Could not create that account.', email: EMAIL });
    expect(logger.error).toHaveBeenCalledWith(
      { reason: 'UNKNOWN', code: 'INTERNAL_ERROR', message: 'x is not a function' },
      'Could not create the account: unexpected error.',
    );
    expect(everythingLogged()).not.toContain(PASSWORD);
  });
});
