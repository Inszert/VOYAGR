import { fixedRates, type RateSource } from '@/core/fx';
import { getEnv } from '@/lib/env';
import { getLogger } from '@/lib/logger';
import { fetchEcbRates } from './ecb';

export { ECB_BASE_CURRENCY, ECB_DAILY_URL, ECB_SOURCE_NAME, fetchEcbRates } from './ecb';
export type { EcbOptions, EcbRatesLoaded } from './ecb';

/**
 * The process-wide exchange-rate table, loaded once and reused.
 *
 * `RateSource.rateFor` is synchronous (`src/core/fx.ts`), so the fetch has to
 * happen here, above it, and the result cached as a plain lookup table - the
 * same shape `fixedRates([])` always was. Cached on `globalThis`, the lesson
 * already paid for once this project (`src/db/index.ts`): a plain
 * module-level `let` is not actually process-wide across a Route Handler and
 * a Server Action's separate module instances under Next.js's App Router.
 *
 * Refreshed once a day - the ECB publishes once a day - rather than once per
 * request. A failed refresh keeps serving the last table it had rather than
 * going empty, because a rate from this morning is a far smaller dishonesty
 * than refusing every conversion until the next business day's file happens
 * to be reachable; the table's own `observedAt` on every rate is still the
 * true date it came from, so nothing is misrepresented as fresher than it is.
 */
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

interface CachedTable {
  readonly source: RateSource;
  readonly loadedAt: number;
}

declare global {
  var __voyagrFxTable: CachedTable | undefined;
  var __voyagrFxLoading: Promise<RateSource> | undefined;
}

const log = getLogger('providers.fx');

async function loadEcbTable(): Promise<RateSource> {
  const result = await fetchEcbRates();

  if (!result.ok) {
    if (globalThis.__voyagrFxTable) {
      log.warn('ECB refresh failed; continuing to serve the previously loaded table');
      return globalThis.__voyagrFxTable.source;
    }

    log.warn('ECB refresh failed with no previous table to fall back to; no rates available');
    return fixedRates([]);
  }

  globalThis.__voyagrFxTable = { source: result.value.source, loadedAt: Date.now() };
  return globalThis.__voyagrFxTable.source;
}

/** The configured rate source - `mock` is the honest empty table, never a guess. */
export async function getRateSource(): Promise<RateSource> {
  const env = getEnv();
  if (env.FX_PROVIDER !== 'ecb') return fixedRates([]);

  const cached = globalThis.__voyagrFxTable;
  if (cached && Date.now() - cached.loadedAt < REFRESH_INTERVAL_MS) {
    return cached.source;
  }

  // Concurrent callers during the same cold start share one fetch rather
  // than each racing the ECB for their own copy.
  globalThis.__voyagrFxLoading ??= loadEcbTable().finally(() => {
    globalThis.__voyagrFxLoading = undefined;
  });

  return globalThis.__voyagrFxLoading;
}

/** Test helper - drops the cached table and in-flight load. */
export function resetRateSource(): void {
  globalThis.__voyagrFxTable = undefined;
  globalThis.__voyagrFxLoading = undefined;
}
