import { getCacheStore } from '@/cache';
import { getRepositories } from '@/db';
import { KiwiReadPath } from '@/providers/flights/kiwi-read-path';
import { getProviderRegistry } from '@/providers/registry';
import { createRouteOffersHandler } from './handler';

/**
 * The click path: `?origin=VIE&destination=BCN&departureDate=&returnDate=&adults=&currency=`.
 * One run of the 12-hour read path (cache, Postgres, then one MCP call, then stale). Never used
 * while the globe merely moves; that is `/api/globe-routes`.
 */

export const dynamic = 'force-dynamic';

declare global {
  var __voyagrRouteOffersReadPath: KiwiReadPath | undefined;
}

function readPath(): KiwiReadPath {
  // One instance per process, so identical clicks share one in-flight call.
  globalThis.__voyagrRouteOffersReadPath ??= new KiwiReadPath({
    provider: getProviderRegistry().flights,
    cache: getCacheStore(),
    repository: getRepositories().kiwiOffers,
  });
  return globalThis.__voyagrRouteOffersReadPath;
}

export const GET = createRouteOffersHandler((query) => readPath().lookup(query));
