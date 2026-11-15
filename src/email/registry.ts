import { AppError } from '@/lib/errors';
import { getEnv, type Env } from '@/lib/env';
import { getLogger } from '@/lib/logger';
import { err } from '@/lib/result';
import { mockAllowed } from '@/providers/mock-policy';
import { createConsoleEmailProvider } from './console';
import { createResendEmailProvider } from './resend';
import type { EmailProvider } from './types';

/**
 * Email provider registry.
 *
 * Mirrors `src/providers/registry.ts`: the one place that decides which
 * adapter is active, so no feature code ever names a vendor.
 *
 * Production refuses `console` for the same reason the provider registry
 * refuses a mock: it would answer "sent" for mail that went nowhere, and
 * every verification and reset link would vanish into a log. The
 * `ALLOW_MOCK_IN_PRODUCTION` opt-in exists for the end-to-end suite and nothing
 * else.
 *
 * **A misconfigured mailer fails the send, never the page.** The auth service
 * builds its mailer when it is constructed, and it is constructed to answer
 * "who is signed in?" on almost every request. Throwing here once took every
 * page down for want of an email setting (2026-11-15). So a bad configuration
 * yields a provider whose every `send` returns the configuration error:
 * sign-up still creates the account, the caller logs the failed mail, and the
 * problem is logged once here at error level.
 */
const log = getLogger('email.registry');

/** Why the configured mailer cannot deliver, or null when it can. */
export function emailConfigurationError(env: Env): AppError | null {
  if (env.EMAIL_PROVIDER === 'console') {
    if (mockAllowed(env)) return null;

    return new AppError(
      'CONFIGURATION_ERROR',
      'EMAIL_PROVIDER=console is not allowed in production: no email would be delivered. Set EMAIL_PROVIDER=resend and RESEND_API_KEY.',
      {
        publicMessage: 'Email delivery is not configured.',
        context: { provider: env.EMAIL_PROVIDER },
      },
    );
  }

  if (!env.RESEND_API_KEY) {
    return new AppError(
      'CONFIGURATION_ERROR',
      'EMAIL_PROVIDER=resend needs RESEND_API_KEY to be set.',
      { publicMessage: 'Email delivery is not configured.', context: { provider: 'resend' } },
    );
  }

  return null;
}

/** A mailer that delivers nothing and says so on every send. */
function createUnconfiguredEmailProvider(reason: AppError): EmailProvider {
  return {
    id: 'unconfigured',
    sendsRealEmail: false,
    send: async () => err(reason),
  };
}

export function buildEmailProvider(env: Env): EmailProvider {
  const problem = emailConfigurationError(env);
  if (problem) {
    log.error({ err: problem }, 'email is not configured; no mail will be sent');
    return createUnconfiguredEmailProvider(problem);
  }

  if (env.EMAIL_PROVIDER === 'console') return createConsoleEmailProvider();

  return createResendEmailProvider({
    // Present: `emailConfigurationError` returned null for the resend branch.
    apiKey: env.RESEND_API_KEY as string,
    from: env.EMAIL_FROM,
    ...(env.EMAIL_REPLY_TO ? { replyTo: env.EMAIL_REPLY_TO } : {}),
  });
}

let cached: EmailProvider | undefined;

export function getEmailProvider(): EmailProvider {
  cached ??= buildEmailProvider(getEnv());
  return cached;
}

/** Test helper - drops the cached provider so a test can vary configuration. */
export function resetEmailProvider(): void {
  cached = undefined;
}
