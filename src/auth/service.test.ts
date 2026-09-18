import { describe, expect, it, beforeEach } from 'vitest';
import { createMemoryRepositories } from '@/db/memory';
import { AppError } from '@/lib/errors';
import type { Repositories } from '@/db/repository';
import { AuthService } from './service';
import { hashSessionToken, issueSessionToken, SESSION_DURATION_MS } from './session';
import { SignInThrottle } from './throttle';

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
