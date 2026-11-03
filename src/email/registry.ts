import { AppError } from '@/lib/errors';
import { getEnv } from '@/lib/env';
import { createConsoleEmailProvider } from './console';
import type { EmailProvider } from './types';

/**
 * Email provider registry.
 *
 * Mirrors `src/providers/registry.ts`: the one place that decides which
 * adapter is active, so no feature code ever names a vendor. Only one
 * provider exists today - see `console.ts`'s module comment for why - but
 * the seam is here so a real one is a new branch, not a rewrite of every
 * call site.
 */
function liveEmailProviderNotImplemented(provider: string): never {
  throw new AppError(
    'CONFIGURATION_ERROR',
    `No email provider named "${provider}" is implemented. Set EMAIL_PROVIDER=console.`,
    {
      publicMessage: 'Email delivery is not configured.',
      context: { provider },
    },
  );
}

let cached: EmailProvider | undefined;

export function getEmailProvider(): EmailProvider {
  if (cached) return cached;

  const env = getEnv();
  cached =
    env.EMAIL_PROVIDER === 'console'
      ? createConsoleEmailProvider()
      : liveEmailProviderNotImplemented(env.EMAIL_PROVIDER);

  return cached;
}

/** Test helper - drops the cached provider so a test can vary configuration. */
export function resetEmailProvider(): void {
  cached = undefined;
}
