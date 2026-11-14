import { AppError } from '@/lib/errors';
import { getEnv, type Env } from '@/lib/env';
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
 */
export function buildEmailProvider(env: Env): EmailProvider {
  if (env.EMAIL_PROVIDER === 'console') {
    if (!mockAllowed(env)) {
      throw new AppError(
        'CONFIGURATION_ERROR',
        'EMAIL_PROVIDER=console is not allowed in production: no email would be delivered. Set EMAIL_PROVIDER=resend and RESEND_API_KEY.',
        {
          publicMessage: 'Email delivery is not configured.',
          context: { provider: env.EMAIL_PROVIDER },
        },
      );
    }

    return createConsoleEmailProvider();
  }

  if (!env.RESEND_API_KEY) {
    throw new AppError(
      'CONFIGURATION_ERROR',
      'EMAIL_PROVIDER=resend needs RESEND_API_KEY to be set.',
      { publicMessage: 'Email delivery is not configured.', context: { provider: 'resend' } },
    );
  }

  return createResendEmailProvider({
    apiKey: env.RESEND_API_KEY,
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
