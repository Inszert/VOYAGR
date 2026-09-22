import { getEnv, type Env } from '@/lib/env';
import { getLogger } from '@/lib/logger';
import { createMockStayProvider } from './mock';
import type { StayProvider } from './types';

/**
 * Which stay providers are active, and in what order.
 *
 * A list rather than a single adapter, because stays fan out: the whole
 * point of the normalized model is that several vendors answer and their
 * results merge. Configuring it is a comma-separated list, so adding a
 * provider later is a deployment change rather than a code change:
 *
 *   STAY_PROVIDERS=duffel,mock
 *
 * **Duffel Stays is deliberately not registered.** The account returns 403
 * on every Stays endpoint - search, accommodation, brands, bookings and
 * loyalty programmes - while Air works on the same key. Registering an
 * adapter that cannot answer would turn a known, stated limitation into an
 * intermittent runtime failure. When Duffel enables the product, the adapter
 * is written, added to `ADAPTERS` and to the contract-test list, and nothing
 * above this file changes.
 */

const log = getLogger('providers.stays.registry');

/** Every adapter this build knows how to construct. */
const ADAPTERS: Record<string, (env: Env) => StayProvider> = {
  mock: () => createMockStayProvider(),
};

let cached: StayProvider[] | null = null;

export function getStayProviders(env: Env = getEnv()): StayProvider[] {
  if (cached) return cached;

  const names = (env.STAY_PROVIDERS ?? 'mock')
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);

  const providers: StayProvider[] = [];

  for (const name of names) {
    const build = ADAPTERS[name];

    if (!build) {
      /*
       * Named but unavailable is a configuration mistake worth saying out
       * loud, and not worth crashing over: the other providers can still
       * answer, and a stay search that works with one fewer vendor is better
       * than a site that will not start.
       */
      log.warn({ provider: name, known: Object.keys(ADAPTERS) }, 'unknown stay provider ignored');
      continue;
    }

    providers.push(build(env));
  }

  // Never an empty list: a search with no providers is an empty page with no
  // explanation, and the mock is always available.
  cached = providers.length > 0 ? providers : [createMockStayProvider()];

  return cached;
}

/** Testing seam. */
export function resetStayProviders(): void {
  cached = null;
}
