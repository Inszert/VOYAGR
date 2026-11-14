import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryRepositories } from '@/db/memory';
import { ok } from '@/lib/result';
import type { Repositories } from '@/db/repository';
import type { EmailMessage, EmailProvider } from '@/email/types';
import { AuthService, sendEntries, UNKNOWN_CLIENT } from './service';
import {
  ACCOUNT_SEND_LIMIT,
  CLIENT_SEND_LIMIT,
  getSendThrottle,
  resetSendThrottle,
  SendThrottle,
  SignInThrottle,
} from './throttle';

/**
 * The limit on how many emails one account or one client can cause.
 *
 * The properties that matter: the limit is exact (the third send passes, the
 * fourth does not, the window reopens on the dot), a refused request spends
 * nothing, and a throttled password reset is indistinguishable from a sent one.
 */

class CapturingProvider implements EmailProvider {
  readonly id = 'capturing';
  readonly sendsRealEmail = false;
  readonly sent: EmailMessage[] = [];

  async send(message: EmailMessage) {
    this.sent.push(message);
    return ok(undefined);
  }
}

const HOUR = 60 * 60 * 1000;
const EMAIL = 'traveller@example.invalid';
const PASSWORD = 'correct-horse-battery-staple';

describe('SendThrottle', () => {
  let clock: number;
  let throttle: SendThrottle;
  const limit = { max: 3, windowMs: HOUR };

  beforeEach(() => {
    clock = 1_000_000;
    throttle = new SendThrottle({ now: () => clock });
  });

  it('allows exactly the limit and refuses the next one', () => {
    for (let sent = 0; sent < 3; sent += 1) {
      expect(throttle.consume([{ key: 'a', limit }]).allowed).toBe(true);
    }

    const refused = throttle.consume([{ key: 'a', limit }]);
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBe(3600);
  });

  it('reports the time left in the window, rounded up to a whole second', () => {
    for (let sent = 0; sent < 3; sent += 1) throttle.consume([{ key: 'a', limit }]);

    clock += HOUR - 1500;
    expect(throttle.consume([{ key: 'a', limit }]).retryAfterSeconds).toBe(2);
  });

  it('reopens at the end of the window, not a millisecond before', () => {
    for (let sent = 0; sent < 3; sent += 1) throttle.consume([{ key: 'a', limit }]);

    clock += HOUR - 1;
    expect(throttle.consume([{ key: 'a', limit }]).allowed).toBe(false);

    clock += 1;
    expect(throttle.consume([{ key: 'a', limit }]).allowed).toBe(true);
  });

  it('does not extend the wait when a refused request is repeated', () => {
    for (let sent = 0; sent < 3; sent += 1) throttle.consume([{ key: 'a', limit }]);

    clock += 10 * 60 * 1000;
    throttle.consume([{ key: 'a', limit }]);
    throttle.consume([{ key: 'a', limit }]);

    clock += 50 * 60 * 1000;
    expect(throttle.consume([{ key: 'a', limit }]).allowed).toBe(true);
  });

  it('keeps keys independent', () => {
    for (let sent = 0; sent < 3; sent += 1) throttle.consume([{ key: 'a', limit }]);

    expect(throttle.consume([{ key: 'b', limit }]).allowed).toBe(true);
  });

  it('takes from every key or from none, so a blocked client cannot drain an account', () => {
    const client = { key: 'client', limit: { max: 1, windowMs: HOUR } };
    const account = { key: 'account', limit };

    expect(throttle.consume([client]).allowed).toBe(true);

    // Refused on the client key; the account must not be charged for it.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(throttle.consume([account, client]).allowed).toBe(false);
    }

    for (let sent = 0; sent < 3; sent += 1) {
      expect(throttle.consume([account]).allowed).toBe(true);
    }
  });

  it('allows an empty set of keys, which is a request nothing limits', () => {
    expect(throttle.consume([]).allowed).toBe(true);
    expect(throttle.size).toBe(0);
  });

  it('prunes windows that have run out and keeps those still open', () => {
    throttle.consume([{ key: 'old', limit }]);
    clock += HOUR / 2;
    throttle.consume([{ key: 'new', limit }]);
    clock += HOUR / 2;

    throttle.prune();
    expect(throttle.size).toBe(1);
  });

  it('is one shared instance per process until reset', () => {
    expect(getSendThrottle()).toBe(getSendThrottle());
    const first = getSendThrottle();
    resetSendThrottle();
    expect(getSendThrottle()).not.toBe(first);
  });
});

describe('what a request is counted against', () => {
  it('counts the account and the client', () => {
    expect(sendEntries('password-reset', 'a@b.c', 'client-1')).toEqual([
      { key: 'password-reset:account:a@b.c', limit: ACCOUNT_SEND_LIMIT },
      { key: 'password-reset:client:client-1', limit: CLIENT_SEND_LIMIT },
    ]);
  });

  it('does not pool every anonymous caller into one client bucket', () => {
    const entries = sendEntries('password-reset', 'a@b.c', UNKNOWN_CLIENT);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.key).toContain(':account:');
  });

  it('keeps one kind of email from spending another kind', () => {
    const keys = (['password-reset', 'verification', 'email-change'] as const).map(
      (kind) => sendEntries(kind, 'same-id', 'same-client')[0]!.key,
    );
    expect(new Set(keys).size).toBe(3);
  });
});

describe('throttled account emails', () => {
  let repositories: Repositories;
  let mail: CapturingProvider;
  let clock: number;
  let auth: AuthService;

  beforeEach(() => {
    repositories = createMemoryRepositories();
    mail = new CapturingProvider();
    clock = Date.parse('2026-11-14T12:00:00Z');
    auth = new AuthService({
      repositories,
      throttle: new SignInThrottle({ now: () => clock }),
      sendThrottle: new SendThrottle({ now: () => clock }),
      now: () => clock,
      emailProvider: mail,
      appUrl: 'https://voyagr.test',
    });
  });

  describe('password reset', () => {
    it('sends three and then quietly sends no more for one address', async () => {
      await auth.register(EMAIL, PASSWORD);
      mail.sent.length = 0;

      for (let request = 0; request < 5; request += 1) {
        await auth.requestPasswordReset(EMAIL, 'client-1');
      }

      expect(mail.sent).toHaveLength(ACCOUNT_SEND_LIMIT.max);
    });

    it('answers a throttled request exactly as it answers a sent one', async () => {
      await auth.register(EMAIL, PASSWORD);

      for (let request = 0; request < ACCOUNT_SEND_LIMIT.max; request += 1) {
        await expect(auth.requestPasswordReset(EMAIL, 'client-1')).resolves.toBeUndefined();
      }
      await expect(auth.requestPasswordReset(EMAIL, 'client-1')).resolves.toBeUndefined();
    });

    it('throttles a registered and an unregistered address identically', async () => {
      await auth.register(EMAIL, PASSWORD);

      const observe = async (address: string) => {
        const outcomes: string[] = [];
        for (let request = 0; request < 5; request += 1) {
          try {
            await auth.requestPasswordReset(address, 'client-1');
            outcomes.push('resolved');
          } catch (error) {
            outcomes.push(`threw ${(error as Error).message}`);
          }
        }
        return outcomes;
      };

      expect(await observe('nobody@example.invalid')).toEqual(await observe(EMAIL));
    });

    it('treats the same address typed in another case as the same account', async () => {
      await auth.register(EMAIL, PASSWORD);
      mail.sent.length = 0;

      for (const variant of [EMAIL, EMAIL.toUpperCase(), ` ${EMAIL} `, EMAIL, EMAIL]) {
        await auth.requestPasswordReset(variant);
      }

      expect(mail.sent).toHaveLength(ACCOUNT_SEND_LIMIT.max);
    });

    it('stops one client spraying many addresses', async () => {
      const addresses = Array.from(
        { length: CLIENT_SEND_LIMIT.max + 1 },
        (_, index) => `person-${index}@example.invalid`,
      );
      for (const address of addresses) await auth.register(address, PASSWORD);
      mail.sent.length = 0;

      // Each address is asked about once, so only the client limit can bite.
      for (const address of addresses) await auth.requestPasswordReset(address, 'one-client');
      expect(mail.sent).toHaveLength(CLIENT_SEND_LIMIT.max);

      // A different client is unaffected, including for the address that was refused.
      await auth.requestPasswordReset(addresses.at(-1)!, 'another-client');
      expect(mail.sent).toHaveLength(CLIENT_SEND_LIMIT.max + 1);
    });

    it('sends again once the hour is up', async () => {
      await auth.register(EMAIL, PASSWORD);
      mail.sent.length = 0;

      for (let request = 0; request < 4; request += 1) await auth.requestPasswordReset(EMAIL);
      expect(mail.sent).toHaveLength(3);

      clock += HOUR;
      await auth.requestPasswordReset(EMAIL);
      expect(mail.sent).toHaveLength(4);
    });
  });

  describe('verification email', () => {
    it('refuses the fourth request in an hour, with a rate-limit error that says when', async () => {
      const issued = await auth.register(EMAIL, PASSWORD);
      // Registration sent one itself and is not counted: it is not a "resend".
      mail.sent.length = 0;

      for (let request = 0; request < ACCOUNT_SEND_LIMIT.max; request += 1) {
        await auth.resendVerificationEmail(issued.user.id, 'client-1');
      }
      expect(mail.sent).toHaveLength(ACCOUNT_SEND_LIMIT.max);

      await expect(auth.resendVerificationEmail(issued.user.id, 'client-1')).rejects.toMatchObject({
        code: 'RATE_LIMITED',
        publicMessage: expect.stringMatching(/try again in 60 minutes/i),
      });
      expect(mail.sent).toHaveLength(ACCOUNT_SEND_LIMIT.max);
    });

    it('is throttled per account, not for everybody', async () => {
      const first = await auth.register(EMAIL, PASSWORD);
      const second = await auth.register('other@example.invalid', PASSWORD);

      for (let request = 0; request < ACCOUNT_SEND_LIMIT.max; request += 1) {
        await auth.resendVerificationEmail(first.user.id);
      }

      await expect(auth.resendVerificationEmail(first.user.id)).rejects.toMatchObject({
        code: 'RATE_LIMITED',
      });
      await expect(auth.resendVerificationEmail(second.user.id)).resolves.toBeUndefined();
    });
  });

  describe('email change', () => {
    it('refuses the fourth request in an hour', async () => {
      const issued = await auth.register(EMAIL, PASSWORD);
      mail.sent.length = 0;

      for (let request = 0; request < ACCOUNT_SEND_LIMIT.max; request += 1) {
        await auth.requestEmailChange(issued.user.id, PASSWORD, `new-${request}@example.invalid`);
      }

      await expect(
        auth.requestEmailChange(issued.user.id, PASSWORD, 'one-too-many@example.invalid'),
      ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
      expect(mail.sent).toHaveLength(ACCOUNT_SEND_LIMIT.max);
    });

    it('is refused before the password is checked, so a wrong guess is not a free probe', async () => {
      const issued = await auth.register(EMAIL, PASSWORD);

      for (let request = 0; request < ACCOUNT_SEND_LIMIT.max; request += 1) {
        await expect(
          auth.requestEmailChange(issued.user.id, 'wrong-password-entirely', 'a@example.invalid'),
        ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
      }

      // Even the right password now meets the limit first.
      await expect(
        auth.requestEmailChange(issued.user.id, PASSWORD, 'a@example.invalid'),
      ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    });
  });
});
