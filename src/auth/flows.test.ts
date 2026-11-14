import { beforeEach, describe, expect, it } from 'vitest';
import { createMemoryRepositories } from '@/db/memory';
import { ok } from '@/lib/result';
import type { Repositories } from '@/db/repository';
import type { EmailMessage, EmailProvider } from '@/email/types';
import { AuthService } from './service';
import { SendThrottle, SignInThrottle } from './throttle';

/**
 * The account lifecycle, end to end, through a provider that records what it is
 * asked to send.
 *
 * The unit tests in `service.test.ts` each cover one method. This is the
 * journey a person takes, reading every link out of the mail they would have
 * received - which is the only way to catch a link that is built wrongly, a
 * token that is not the one stored, or a step that leaves the account in a
 * state the next step cannot use.
 */

class CapturingProvider implements EmailProvider {
  readonly id = 'capturing';
  readonly sendsRealEmail = true;
  readonly sent: EmailMessage[] = [];

  async send(message: EmailMessage) {
    this.sent.push(message);
    return ok(undefined);
  }

  last(): EmailMessage {
    const message = this.sent.at(-1);
    if (!message) throw new Error('Nothing was sent');
    return message;
  }
}

const APP_URL = 'https://voyagr.test';
const EMAIL = 'traveller@example.invalid';
const NEW_EMAIL = 'moved@example.invalid';
const PASSWORD = 'correct-horse-battery-staple';
const NEW_PASSWORD = 'a-different-long-passphrase';

/** The link a person would click: the button's href in the HTML, which must match the text one. */
function linkIn(message: EmailMessage): URL {
  const fromHtml = /<a href="([^"]+)" style="display:inline-block;min-height:44px/.exec(
    message.html ?? '',
  )?.[1];
  const fromText = /: (https?:\/\/\S+)/.exec(message.text)?.[1];

  if (!fromHtml || !fromText) throw new Error('No link found in the captured email');
  expect(fromHtml).toBe(fromText);

  return new URL(fromHtml);
}

let repositories: Repositories;
let mail: CapturingProvider;
let auth: AuthService;
let clock: number;

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
    appUrl: APP_URL,
  });
});

describe('account lifecycle', () => {
  it('registers, verifies, signs in, resets the password, then changes and confirms the email', async () => {
    // Register: signed in at once, one verification mail, to the right address.
    const registered = await auth.register(EMAIL, PASSWORD);
    expect(registered.user.emailVerified).toBe(false);
    expect(mail.sent).toHaveLength(1);
    expect(mail.last().to).toBe(EMAIL);
    expect(mail.last().subject).toMatch(/confirm your email/i);

    // Verify through the link in the mail.
    const verifyLink = linkIn(mail.last());
    expect(verifyLink.origin).toBe(APP_URL);
    expect(verifyLink.pathname).toBe('/api/verify-email');
    await auth.verifyEmail(verifyLink.searchParams.get('token')!);

    const verified = await auth.authenticate(registered.token);
    expect(verified?.emailVerified).toBe(true);

    // Sign in again from scratch.
    await expect(auth.signIn(EMAIL, PASSWORD)).resolves.toBeTruthy();

    // Forgot password: mail goes out, the link leads to the reset page.
    await auth.requestPasswordReset(EMAIL);
    expect(mail.sent).toHaveLength(2);
    expect(mail.last().to).toBe(EMAIL);

    const resetLink = linkIn(mail.last());
    expect(resetLink.pathname).toBe('/reset-password');

    // Reset: every session dies, the old password stops working, the new one works.
    await auth.resetPassword(resetLink.searchParams.get('token')!, NEW_PASSWORD);
    expect(await auth.authenticate(registered.token)).toBeNull();
    await expect(auth.signIn(EMAIL, PASSWORD)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    const afterReset = await auth.signIn(EMAIL, NEW_PASSWORD);

    // Change email: the mail goes to the NEW address and nothing has moved yet.
    await auth.requestEmailChange(afterReset.user.id, NEW_PASSWORD, NEW_EMAIL);
    expect(mail.sent).toHaveLength(3);
    expect(mail.last().to).toBe(NEW_EMAIL);
    expect((await repositories.users.findById(afterReset.user.id))?.email).toBe(EMAIL);

    const changeLink = linkIn(mail.last());
    expect(changeLink.pathname).toBe('/api/confirm-email-change');

    // Confirm: the account moves, old sessions end, and the new address signs in.
    await auth.confirmEmailChange(changeLink.searchParams.get('token')!);
    expect(await auth.authenticate(afterReset.token)).toBeNull();
    await expect(auth.signIn(EMAIL, NEW_PASSWORD)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });

    const movedIn = await auth.signIn(NEW_EMAIL, NEW_PASSWORD);
    expect(movedIn.user.email).toBe(NEW_EMAIL);

    // Clicking a link sent to the new inbox is proof the address is reachable.
    expect(movedIn.user.emailVerified).toBe(true);
  });

  it('keeps every link single-use: replaying a consumed one fails', async () => {
    await auth.register(EMAIL, PASSWORD);
    const token = linkIn(mail.last()).searchParams.get('token')!;

    await auth.verifyEmail(token);
    await expect(auth.verifyEmail(token)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    await auth.requestPasswordReset(EMAIL);
    const resetToken = linkIn(mail.last()).searchParams.get('token')!;

    await auth.resetPassword(resetToken, NEW_PASSWORD);
    await expect(auth.resetPassword(resetToken, PASSWORD + '!')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('still creates the account when the provider is down, and the resend works once it is up', async () => {
    const failing: EmailProvider = {
      id: 'down',
      sendsRealEmail: true,
      async send() {
        const { err } = await import('@/lib/result');
        const { AppError } = await import('@/lib/errors');
        return err(new AppError('PROVIDER_UNAVAILABLE', 'down'));
      },
    };
    const flaky = new AuthService({
      repositories,
      throttle: new SignInThrottle({ now: () => clock }),
      sendThrottle: new SendThrottle({ now: () => clock }),
      now: () => clock,
      emailProvider: failing,
      appUrl: APP_URL,
    });

    const issued = await flaky.register(EMAIL, PASSWORD);
    expect(issued.user.email).toBe(EMAIL);

    await auth.resendVerificationEmail(issued.user.id);
    await auth.verifyEmail(linkIn(mail.last()).searchParams.get('token')!);

    expect((await auth.authenticate(issued.token))?.emailVerified).toBe(true);
  });

  it('sends the reset mail for a known address and nothing for an unknown one', async () => {
    await auth.register(EMAIL, PASSWORD);
    const before = mail.sent.length;

    await auth.requestPasswordReset('nobody@example.invalid');
    expect(mail.sent).toHaveLength(before);

    await auth.requestPasswordReset(EMAIL);
    expect(mail.sent).toHaveLength(before + 1);
  });

  it('carries no unsubscribe header on any account mail', async () => {
    await auth.register(EMAIL, PASSWORD);
    await auth.requestPasswordReset(EMAIL);

    for (const message of mail.sent) {
      expect(message.headers).toBeUndefined();
    }
  });
});
