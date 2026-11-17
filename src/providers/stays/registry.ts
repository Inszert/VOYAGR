import { AppError } from '@/lib/errors';
import { getEnv, type Env } from '@/lib/env';
import type { DataSource } from '../data-source';
import { getLogger } from '@/lib/logger';
import { createAbsentStayProvider } from '../absent';
import { mockAllowed } from '../mock-policy';
import { createLiteApiStayProvider } from './liteapi';
import { createMockStayProvider } from './mock';
import { createTravelpayoutsLinksProvider } from './travelpayouts-links';
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
const ADAPTERS: Record<string, (env: Env) => StayProvider | null> = {
  mock: () => createMockStayProvider(),
  absent: () => createAbsentStayProvider(),
  // Affiliate links, no prices. Unavailable until its three identifiers are set.
  'travelpayouts-links': (env) => createTravelpayoutsLinksProvider(env),
  // Hotel rates. Absent (null) without LITEAPI_API_KEY, and only when STAY_PROVIDERS names it.
  liteapi: (env) => createLiteApiStayProvider(env),
};

/**
 * Cached on `globalThis`, not a plain module-level `const` Map.
 *
 * Reviewed alongside the five named singletons (phase 2): today's only
 * caller is `src/app/stays/page.tsx`, a Server Component - no Route Handler
 * reaches this, so the module-duplication split `src/db/index.ts` proved
 * real does not currently apply here. Moved anyway, for the same reason the
 * other low-risk ones were: cheap, and "not reachable today" is a fact
 * about today's call sites, not a property of this cache.
 */
declare global {
  var __voyagrStayProviders: Map<DataSource, StayProvider[]> | undefined;
}

function cached(): Map<DataSource, StayProvider[]> {
  globalThis.__voyagrStayProviders ??= new Map<DataSource, StayProvider[]>();
  return globalThis.__voyagrStayProviders;
}

/**
 * @param source `mock` forces the fixture list, whatever is configured, for
 *   the runtime data-source switch. It is the same resolution path, with the
 *   provider list replaced - never a second way of building providers.
 */
export function getStayProviders(env: Env = getEnv(), source: DataSource = 'api'): StayProvider[] {
  const existing = cached().get(source);
  if (existing) return existing;

  const fixturesAllowed = mockAllowed(env);

  const names = (source === 'mock' ? 'mock' : (env.STAY_PROVIDERS ?? 'mock'))
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);

  const providers: StayProvider[] = [];

  for (const name of names) {
    const build = ADAPTERS[name];

    if (name === 'mock' && !fixturesAllowed) {
      throw new AppError(
        'CONFIGURATION_ERROR',
        'STAY_PROVIDERS names "mock" in production. Fixtures are never served there.',
      );
    }

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

    const built = build(env);
    if (built) providers.push(built);
    else log.info({ provider: name }, 'stay provider absent: its credential is not set');
  }

  // Never an empty list: a search with no providers is an empty page with no
  // explanation. The fallback says so - and is a fixture only where fixtures
  // are allowed.
  const resolved =
    providers.length > 0
      ? providers
      : [fixturesAllowed ? createMockStayProvider() : createAbsentStayProvider()];
  cached().set(source, resolved);

  return resolved;
}

/** Testing seam. */
export function resetStayProviders(): void {
  globalThis.__voyagrStayProviders = undefined;
}
