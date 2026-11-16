import { getEnv, type Env } from '@/lib/env';
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
  // Environment validation admits only `mock` until a real adapter exists
  // (`AI_PROVIDER=anthropic` is refused in `src/lib/env.ts`), so asking for
  // anything else can never reach here and quietly get mock output. When an
  // adapter lands, widen the schema and add its case to this switch.
  switch (env.AI_PROVIDER) {
    case 'mock':
      return createMockAiProvider();
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
  validateItinerary,
  validateParsedRequest,
  withFigureGuard,
} from './guardrails';
