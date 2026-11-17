import { createLimiterPool, type LimiterPool } from '@/lib/concurrency';

/**
 * The one limiter pool for every vendor that states a rate limit, held for the
 * life of the process.
 *
 * A rate limit belongs to a vendor, not to a search. A pool made inside each
 * search gave every concurrent search, and every refresh job, a limiter of its
 * own, so the vendor's limit was multiplied by however many ran at once. Keyed
 * on the provider id and shared here, there is exactly one limiter per vendor
 * per process.
 *
 * On `globalThis` so a bundler that loads this module twice (route handler and
 * server component) still shares one pool. Web and worker are separate
 * processes and each has its own; see the pause note in
 * `flights/aviasales.ts`.
 */
declare global {
  var __voyagrVendorLimiters: LimiterPool | undefined;
}

export function sharedVendorLimiters(): LimiterPool {
  globalThis.__voyagrVendorLimiters ??= createLimiterPool(4);
  return globalThis.__voyagrVendorLimiters;
}
