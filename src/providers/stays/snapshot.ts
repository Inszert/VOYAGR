import type { StayOffer, StayQuery } from '@/core/stay/types';
import { liteApiEnvironment, type Env } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { err, ok } from '@/lib/result';
import { readSnapshot, type SnapshotReadDependencies } from '@/liteapi-snapshot/read';
import type { ProviderResult } from '../types';
import type { StayProvider } from './types';

/**
 * LiteAPI hotel rates, read from our own snapshot.
 *
 * This is what the stays registry builds for `liteapi`. It makes **no vendor call, ever**: a
 * visitor's search reads the rows the worker's scheduled refresh wrote
 * (`src/liteapi-snapshot/job.ts`). It does not import the live adapter, and
 * `src/liteapi-snapshot/import-guard.test.ts` holds that.
 *
 * A destination, window or party with no row answers `ok([])`: no price, which the page says
 * in plain words (`snapshotStatus`). It is not an error and not a zero.
 */

const log = getLogger('providers.stays.snapshot');

export const SNAPSHOT_PROVIDER_ID = 'liteapi';

export interface SnapshotStayProviderOptions {
  /** Defaults to the real repositories and env, resolved on each search. */
  readonly dependencies?: () => SnapshotReadDependencies;
  readonly now?: () => number;
}

/** Null without a key, as the live adapter was: the provider is then absent from the registry. */
export function createSnapshotStayProvider(
  env: Pick<Env, 'LITEAPI_API_KEY'>,
  options: SnapshotStayProviderOptions = {},
): SnapshotStayProvider | null {
  if (!env.LITEAPI_API_KEY) return null;
  const mode = liteApiEnvironment(env);
  log.info({ mode }, 'liteapi snapshot stay provider enabled');
  return new SnapshotStayProvider(mode === 'sandbox' ? 'test' : 'live', options);
}

export class SnapshotStayProvider implements StayProvider {
  readonly metadata: StayProvider['metadata'];

  constructor(
    mode: 'test' | 'live',
    private readonly options: SnapshotStayProviderOptions = {},
  ) {
    this.metadata = {
      id: SNAPSHOT_PROVIDER_ID,
      kind: 'stays',
      displayName: 'LiteAPI',
      isMock: false,
      mode,
      rateLimitPerMinute: null,
    };
  }

  async searchStays(query: StayQuery): Promise<ProviderResult<readonly StayOffer[]>> {
    try {
      const read = await readSnapshot(
        query,
        (this.options.now ?? Date.now)(),
        this.options.dependencies?.(),
      );
      return ok(read.offers);
    } catch (error) {
      // Our own database, not the vendor: one fewer source, never an empty page.
      log.warn(
        { code: error instanceof AppError ? error.code : 'INTERNAL_ERROR' },
        'snapshot read failed',
      );
      return err(
        new AppError('DEPENDENCY_UNAVAILABLE', 'The stored hotel prices could not be read.'),
      );
    }
  }
}
