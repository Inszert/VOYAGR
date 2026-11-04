import { describe, expect, it, beforeEach } from 'vitest';
import { createMemoryRepositories } from '@/db/memory';
import { AppError } from '@/lib/errors';
import { ok } from '@/lib/result';
import type { Repositories } from '@/db/repository';
import type { EmailMessage, EmailProvider } from '@/email/types';
import { AuthService } from './service';
import { hashSessionToken, issueSessionToken, SESSION_DURATION_MS } from './session';
import { SignInThrottle } from './throttle';

/** Captures what was "sent" instead of a real provider, so a test can read the link out of it. */
class CapturingEmailProvider implements EmailProvider {
  readonly id = 'capturing';
  readonly sendsRealEmail = false;
  readonly sent: EmailMessage[] = [];

  async send(message: EmailMessage) {
    this.sent.push(message);
    return ok(undefined);
  }
}

function extractToken(message: EmailMessage): string {
  const match = /token=([^\s]+)/.exec(message.text);
  if (!match) throw new Error('No token found in the captured email');
  return match[1]!;
}

/**
 * Authentication behaviour.
 *
 * The properties defended here are the ones that are expensive to get wrong:
 * a session token that survives a database dump, a sign-in that does not tell
 * strangers which addresses are registered, and a password change that does not
 * leave the old sessions alive.
 */

const EMAIL = 'traveller@example.invalid';
const PASSWORD = 'correct-horse-battery-staple';

let repositories: Repositories;
let auth: AuthService;
let clock: number;

beforeEach(() => {
  repositories = createMemoryRepositories();
  clock = Date.parse('2026-09-18T12:00:00Z');
  auth = new AuthService({
    repositories,
    throttle: new SignInThrottle({ now: () => clock }),
    now: () => clock,
  });
});

describe('register', () => {
  it('creates an account, signs it in and puts it on the default plan', async () => {
    const issued = await auth.register(EMAIL, PASSWORD);

    expect(issued.user.email).toBe(EMAIL);
    expect(issued.user.plan).toBe('free');
    // Entitlements are resolved from the plan, never hard-coded at a call site.
    expect(issued.user.entitlements.maxActiveWatches).toBeGreaterThan(0);
    expect(issued.token.length).toBeGreaterThan(20);
  });

  it('normalises the email, so one address cannot become two accounts', async () => {
    await auth.register('  Traveller@Example.Invalid  ', PASSWORD);

    expect(await repositories.users.findByEmail(EMAIL)).not.toBeNull();
    await expect(auth.register('TRAVELLER@EXAMPLE.INVALID', PASSWORD)).rejects.toThrow(AppError);
  });

  it('rejects an implausible email and a short password', async () => {
    await expect(auth.register('not-an-email', PASSWORD)).rejects.toThrow(AppError);
    await expect(auth.register(EMAIL, 'short')).rejects.toThrow(AppError);
  });

  it('never stores the password', async () => {
    await auth.register(EMAIL, PASSWORD);
    const user = await repositories.users.findByEmail(EMAIL);
    const credential = await repositories.credentials.findByUserId(user!.id);

    expect(credential!.passwordHash).not.toContain(PASSWORD);
    expect(credential!.passwordHash.startsWith('scrypt$')).toBe(true);
  });

  it('stores only the hash of the session token', async () => {
    // A dump of the sessions table must grant nobody a session.
    const issued = await auth.register(EMAIL, PASSWORD);
    const session = await repositories.sessions.findByTokenHash(hashSessionToken(issued.token));

    expect(session).not.toBeNull();
    expect(session!.tokenHash).not.toBe(issued.token);
    expect(await repositories.sessions.findByTokenHash(issued.token)).toBeNull();
  });
});

describe('signIn', () => {
  beforeEach(async () => {
    await auth.register(EMAIL, PASSWORD);
  });

  it('accepts the right password', async () => {
    const issued = await auth.signIn(EMAIL, PASSWORD);
    expect(issued.user.email).toBe(EMAIL);
  });

  it('is case-insensitive about the email', async () => {
    await expect(auth.signIn('TRAVELLER@Example.invalid', PASSWORD)).resolves.toBeTruthy();
  });

  it('gives the same answer whether or not the address exists', async () => {
    // The cheap oracle an attacker wants is "is this address registered?".
    const wrongPassword = await auth.signIn(EMAIL, 'wrong-password-entirely').catch((e) => e);
    const noSuchUser = await auth.signIn('nobody@example.invalid', PASSWORD).catch((e) => e);

    expect(wrongPassword).toBeInstanceOf(AppError);
    expect(noSuchUser).toBeInstanceOf(AppError);
    expect((noSuchUser as AppError).publicMessage).toBe((wrongPassword as AppError).publicMessage);
    expect((noSuchUser as AppError).code).toBe((wrongPassword as AppError).code);
  });

  it('issues a new session each time rather than reusing one', async () => {
    const first = await auth.signIn(EMAIL, PASSWORD);
    const second = await auth.signIn(EMAIL, PASSWORD);

    expect(first.token).not.toBe(second.token);
    expect(await auth.authenticate(first.token)).not.toBeNull();
    expect(await auth.authenticate(second.token)).not.toBeNull();
  });
});

describe('signIn throttling', () => {
  beforeEach(async () => {
    await auth.register(EMAIL, PASSWORD);
  });

  it('locks out after repeated failures and says when to try again', async () => {
    // All attempts come from the same client, which is what a real brute force
    // from one machine looks like.
    // Password verification is deliberately expensive, so an unthrottled
    // endpoint is both a brute-force target and a way to burn every CPU.
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await expect(auth.signIn(EMAIL, 'wrong')).rejects.toThrow(AppError);
    }

    const error = await auth.signIn(EMAIL, PASSWORD).catch((e: AppError) => e);

    expect((error as AppError).code).toBe('RATE_LIMITED');
    expect((error as AppError).publicMessage).toMatch(/try again/i);
  });

  it('lets the right password through once the lockout expires', async () => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await auth.signIn(EMAIL, 'wrong').catch(() => undefined);
    }

    clock += 16 * 60 * 1000;

    await expect(auth.signIn(EMAIL, PASSWORD)).resolves.toBeTruthy();
  });

  it('clears the count after a genuine sign-in', async () => {
    await auth.signIn(EMAIL, 'wrong').catch(() => undefined);
    await auth.signIn(EMAIL, PASSWORD);

    for (let attempt = 0; attempt < 7; attempt += 1) {
      await auth.signIn(EMAIL, 'wrong').catch(() => undefined);
    }

    // Seven failures after a reset is still under the limit.
    await expect(auth.signIn(EMAIL, PASSWORD)).resolves.toBeTruthy();
  });
});

describe('authenticate', () => {
  it('resolves the user behind a valid token', async () => {
    const issued = await auth.register(EMAIL, PASSWORD);
    const user = await auth.authenticate(issued.token);

    expect(user?.email).toBe(EMAIL);
    expect(user?.entitlements.planId).toBe('free');
  });

  it('answers null rather than throwing for anything wrong', async () => {
    expect(await auth.authenticate(undefined)).toBeNull();
    expect(await auth.authenticate('')).toBeNull();
    expect(await auth.authenticate('a-token-nobody-issued')).toBeNull();
  });

  it('rejects an expired session and cleans it up', async () => {
    const issued = await auth.register(EMAIL, PASSWORD);
    clock += SESSION_DURATION_MS + 1000;

    expect(await auth.authenticate(issued.token)).toBeNull();
    expect(await repositories.sessions.findByTokenHash(hashSessionToken(issued.token))).toBeNull();
  });

  it('rejects a session whose account no longer exists', async () => {
    // A session outliving its user is an orphan, not an identity. Built
    // directly rather than by deleting a user, so the test exercises the
    // missing-account branch instead of the missing-session one.
    const { token, tokenHash } = issueSessionToken();
    await repositories.sessions.create({
      id: 'orphan-session',
      userId: 'a-user-that-was-deleted',
      tokenHash,
      expiresAt: new Date(clock + SESSION_DURATION_MS).toISOString(),
    });

    expect(await auth.authenticate(token)).toBeNull();
    // And the orphan is cleaned up on the way past.
    expect(await repositories.sessions.findByTokenHash(tokenHash)).toBeNull();
  });
});

describe('signOut', () => {
  it('destroys the session it was given and leaves others alone', async () => {
    const first = await auth.register(EMAIL, PASSWORD);
    const second = await auth.signIn(EMAIL, PASSWORD);

    await auth.signOut(first.token);

    expect(await auth.authenticate(first.token)).toBeNull();
    expect(await auth.authenticate(second.token)).not.toBeNull();
  });

  it('does nothing, quietly, when there is no session', async () => {
    await expect(auth.signOut(undefined)).resolves.toBeUndefined();
    await expect(auth.signOut('not-a-real-token')).resolves.toBeUndefined();
  });
});

describe('changePassword', () => {
  it('requires the current password', async () => {
    const issued = await auth.register(EMAIL, PASSWORD);

    await expect(
      auth.changePassword(issued.user.id, 'wrong', 'a-brand-new-passphrase'),
    ).rejects.toThrow(AppError);
  });

  it('signs every session out, everywhere', async () => {
    // A password change is usually a response to suspecting someone else has
    // the old one, so leaving their session alive defeats the point.
    const first = await auth.register(EMAIL, PASSWORD);
    const second = await auth.signIn(EMAIL, PASSWORD);

    await auth.changePassword(first.user.id, PASSWORD, 'a-brand-new-passphrase');

    expect(await auth.authenticate(first.token)).toBeNull();
    expect(await auth.authenticate(second.token)).toBeNull();
  });

  it('accepts the new password afterwards and refuses the old one', async () => {
    const issued = await auth.register(EMAIL, PASSWORD);
    await auth.changePassword(issued.user.id, PASSWORD, 'a-brand-new-passphrase');

    await expect(auth.signIn(EMAIL, 'a-brand-new-passphrase')).resolves.toBeTruthy();
    await expect(auth.signIn(EMAIL, PASSWORD)).rejects.toThrow(AppError);
  });

  it('refuses a new password below the minimum length', async () => {
    const issued = await auth.register(EMAIL, PASSWORD);
    await expect(auth.changePassword(issued.user.id, PASSWORD, 'short')).rejects.toThrow(AppError);
  });
});

describe('throttling is scoped to the client, not just the address', () => {
  beforeEach(async () => {
    await auth.register(EMAIL, PASSWORD);
  });

  it('does not let one client lock another out of their own account', async () => {
    // Throttling on the email alone turns the lockout into a weapon: anyone who
    // knows your address could keep you out of your own account at will.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await auth.signIn(EMAIL, 'wrong', 'attacker-client').catch(() => undefined);
    }

    await expect(auth.signIn(EMAIL, 'wrong', 'attacker-client')).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });

    // The real user, from their own client, is unaffected.
    await expect(auth.signIn(EMAIL, PASSWORD, 'owner-client')).resolves.toBeTruthy();
  });

  it('still throttles a single client hammering one account', async () => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await auth.signIn(EMAIL, 'wrong', 'one-client').catch(() => undefined);
    }

    await expect(auth.signIn(EMAIL, PASSWORD, 'one-client')).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
  });
});

describe('email verification', () => {
  let email: CapturingEmailProvider;
  let authWithEmail: AuthService;

  beforeEach(() => {
    email = new CapturingEmailProvider();
    authWithEmail = new AuthService({
      repositories,
      now: () => clock,
      emailProvider: email,
      appUrl: 'https://voyagr.test',
    });
  });

  it('sends a verification email on registration, with a working link', async () => {
    const issued = await authWithEmail.register(EMAIL, PASSWORD);

    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]!.to).toBe(EMAIL);
    expect(email.sent[0]!.text).toContain('https://voyagr.test/api/verify-email?token=');
    expect(issued.user.emailVerified).toBe(false);
  });

  it('marks the account verified once the token is consumed', async () => {
    await authWithEmail.register(EMAIL, PASSWORD);
    const token = extractToken(email.sent[0]!);

    await authWithEmail.verifyEmail(token);

    const user = await repositories.users.findByEmail(EMAIL);
    expect(user?.emailVerifiedAt).not.toBeNull();
  });

  it('refuses an unknown token', async () => {
    await expect(authWithEmail.verifyEmail('not-a-real-token')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('refuses the same token twice - one-time use even within its window', async () => {
    await authWithEmail.register(EMAIL, PASSWORD);
    const token = extractToken(email.sent[0]!);

    await authWithEmail.verifyEmail(token);

    await expect(authWithEmail.verifyEmail(token)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('refuses an expired token, even though it was never used', async () => {
    await authWithEmail.register(EMAIL, PASSWORD);
    const token = extractToken(email.sent[0]!);

    clock += 25 * 60 * 60 * 1000; // past the 24-hour window

    await expect(authWithEmail.verifyEmail(token)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('resend invalidates the previous link and sends a new, different one', async () => {
    await authWithEmail.register(EMAIL, PASSWORD);
    const firstToken = extractToken(email.sent[0]!);

    const user = await repositories.users.findByEmail(EMAIL);
    await authWithEmail.resendVerificationEmail(user!.id);

    expect(email.sent).toHaveLength(2);
    const secondToken = extractToken(email.sent[1]!);
    expect(secondToken).not.toBe(firstToken);

    await expect(authWithEmail.verifyEmail(firstToken)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    await expect(authWithEmail.verifyEmail(secondToken)).resolves.toBeUndefined();
  });

  it('does nothing for an already-verified account - no link to leak, no email to spam with', async () => {
    await authWithEmail.register(EMAIL, PASSWORD);
    const token = extractToken(email.sent[0]!);
    await authWithEmail.verifyEmail(token);

    const user = await repositories.users.findByEmail(EMAIL);
    await authWithEmail.resendVerificationEmail(user!.id);

    expect(email.sent).toHaveLength(1);
  });

  it('does not fail registration when the email provider fails', async () => {
    class FailingEmailProvider implements EmailProvider {
      readonly id = 'failing';
      readonly sendsRealEmail = false;
      async send() {
        return { ok: false as const, error: new AppError('PROVIDER_UNAVAILABLE', 'down') };
      }
    }

    const authWithFailingEmail = new AuthService({
      repositories,
      now: () => clock,
      emailProvider: new FailingEmailProvider(),
      appUrl: 'https://voyagr.test',
    });

    await expect(authWithFailingEmail.register(EMAIL, PASSWORD)).resolves.toBeTruthy();
  });
});

function extractResetToken(message: EmailMessage): string {
  const match = /token=([^\s]+)/.exec(message.text);
  if (!match) throw new Error('No token found in the captured email');
  return match[1]!;
}

describe('password reset', () => {
  let email: CapturingEmailProvider;
  let authWithEmail: AuthService;

  beforeEach(() => {
    email = new CapturingEmailProvider();
    authWithEmail = new AuthService({
      repositories,
      now: () => clock,
      emailProvider: email,
      appUrl: 'https://voyagr.test',
    });
  });

  it('sends a reset email for a registered address, with a working link', async () => {
    await authWithEmail.register(EMAIL, PASSWORD);
    email.sent.length = 0; // discard the registration's own verification email

    await authWithEmail.requestPasswordReset(EMAIL);

    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]!.to).toBe(EMAIL);
    expect(email.sent[0]!.text).toContain('https://voyagr.test/reset-password?token=');
  });

  it('does nothing, visibly, for an unregistered address - same silence sign-in already holds', async () => {
    await authWithEmail.requestPasswordReset('nobody@example.invalid');
    expect(email.sent).toHaveLength(0);
  });

  it('sets the new password and signs every session out', async () => {
    const issued = await authWithEmail.register(EMAIL, PASSWORD);
    email.sent.length = 0;
    await authWithEmail.requestPasswordReset(EMAIL);
    const token = extractResetToken(email.sent[0]!);

    await authWithEmail.resetPassword(token, 'a-brand-new-password-1234');

    // The old session is gone.
    expect(await authWithEmail.authenticate(issued.token)).toBeNull();
    // The new password works; the old one does not.
    await expect(authWithEmail.signIn(EMAIL, 'a-brand-new-password-1234')).resolves.toBeTruthy();
    await expect(authWithEmail.signIn(EMAIL, PASSWORD)).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
    });
  });

  it('refuses an unknown token', async () => {
    await expect(
      authWithEmail.resetPassword('not-a-real-token', 'a-brand-new-password-1234'),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('refuses the same token twice - one-time use even within its window', async () => {
    await authWithEmail.register(EMAIL, PASSWORD);
    email.sent.length = 0;
    await authWithEmail.requestPasswordReset(EMAIL);
    const token = extractResetToken(email.sent[0]!);

    await authWithEmail.resetPassword(token, 'a-brand-new-password-1234');

    await expect(
      authWithEmail.resetPassword(token, 'yet-another-password-5678'),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('refuses an expired token, even though it was never used', async () => {
    await authWithEmail.register(EMAIL, PASSWORD);
    email.sent.length = 0;
    await authWithEmail.requestPasswordReset(EMAIL);
    const token = extractResetToken(email.sent[0]!);

    clock += 61 * 60 * 1000; // past the 1-hour window

    await expect(
      authWithEmail.resetPassword(token, 'a-brand-new-password-1234'),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('refuses a new password that is too short', async () => {
    await authWithEmail.register(EMAIL, PASSWORD);
    email.sent.length = 0;
    await authWithEmail.requestPasswordReset(EMAIL);
    const token = extractResetToken(email.sent[0]!);

    await expect(authWithEmail.resetPassword(token, 'short')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('a second request invalidates the first link', async () => {
    await authWithEmail.register(EMAIL, PASSWORD);
    email.sent.length = 0;
    await authWithEmail.requestPasswordReset(EMAIL);
    const firstToken = extractResetToken(email.sent[0]!);

    await authWithEmail.requestPasswordReset(EMAIL);
    const secondToken = extractResetToken(email.sent[1]!);

    await expect(
      authWithEmail.resetPassword(firstToken, 'a-brand-new-password-1234'),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      authWithEmail.resetPassword(secondToken, 'a-brand-new-password-1234'),
    ).resolves.toBeUndefined();
  });
});
