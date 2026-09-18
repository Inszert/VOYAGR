import { getEnv, type Env } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { createMockAiProvider } from './providers/mock';
import type { AiProvider } from './types';

/**
 * AI provider factory.
 *
 * The one place that knows which model vendor is in use. Feature code imports
 * `getAiProvider()` and never a vendor SDK, so switching provider is a change
 * here plus one new adapter module.
 */

const log = getLogger('ai.factory');

export function createAiProvider(env: Env = getEnv()): AiProvider {
  switch (env.AI_PROVIDER) {
    case 'mock':
      return createMockAiProvider();

    case 'anthropic':
      // Not implemented yet, and deliberately a hard failure rather than a
      // silent fallback: configuring a live provider and quietly getting mock
      // output would be worse than an error.
      throw new AppError(
        'CONFIGURATION_ERROR',
        'The Anthropic AI adapter is not implemented yet. Set AI_PROVIDER=mock.',
        {
          publicMessage: 'The assistant is not configured.',
          context: { provider: env.AI_PROVIDER },
        },
      );
  }
}

let provider: AiProvider | undefined;

export function getAiProvider(): AiProvider {
  if (!provider) {
    provider = createAiProvider();
    log.info(
      { provider: provider.metadata.id, isMock: provider.metadata.isMock },
      'AI provider initialised',
    );
  }
  return provider;
}

/** Test helper - drops the cached provider so a test can vary configuration. */
export function resetAiProvider(): void {
  provider = undefined;
}

export type * from './types';
export {
  assertNoInventedFigures,
  toSearchProfile,
  validateParsedRequest,
  withFigureGuard,
} from './guardrails';
