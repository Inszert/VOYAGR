import { getLogger } from '@/lib/logger';
import { ok } from '@/lib/result';
import type { EmailMessage, EmailProvider } from './types';

/**
 * Local development mail capture.
 *
 * Writes the message to the structured log instead of sending it anywhere.
 * This is the default and, at the time of writing, the only `EmailProvider` -
 * no free email vendor has been researched and wired in yet, so there is
 * nothing to fall back from. `sendsRealEmail: false` is read by the account
 * page and the sign-up flow to say so honestly rather than implying a real
 * email went out.
 *
 * The email address and the full message text are logged deliberately: the
 * entire point is for a developer to find the verification link somewhere.
 * That is correct for a local log a developer is reading and wrong for a
 * shared production log - this provider must never be selected in a real
 * deployment, which is why `src/email/registry.ts` only resolves it when
 * `EMAIL_PROVIDER=console`, the explicit default, not a silent fallback.
 */

const log = getLogger('email.console');

export class ConsoleEmailProvider implements EmailProvider {
  readonly id = 'console';
  readonly sendsRealEmail = false;

  async send(message: EmailMessage): ReturnType<EmailProvider['send']> {
    log.warn(
      { to: message.to, subject: message.subject, text: message.text },
      'DEV MODE - no email was actually sent; find the link above',
    );

    return ok(undefined);
  }
}

export function createConsoleEmailProvider(): EmailProvider {
  return new ConsoleEmailProvider();
}
