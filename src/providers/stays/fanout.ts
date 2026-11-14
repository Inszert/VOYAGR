import { canonicalise, type CanonicalStay } from '@/core/stay/identity';
import type { StayLinkOffer, StayOffer, StayQuery } from '@/core/stay/types';
import type { Limiter } from '@/lib/concurrency';
import { getLogger } from '@/lib/logger';
import type { ProviderRequestOptions } from '../types';
import type { StayProvider } from './types';

/**
 * Asking every stay provider at once, and merging what comes back.
 *
 * This is the piece that makes providers interchangeable rather than merely
 * swappable. Nothing above it knows how many answered, which answered, or
 * which one produced any given rate: it gets canonical properties, each
 * carrying whatever offers were found for it.
 *
 * **One provider failing must not empty the page.** A fan-out that rejects
 * when any leg rejects is a fan-out that gets less reliable with every
 * provider added, which is the opposite of the point. Failures are collected
 * and reported; whoever answered is still shown.
 */

const log = getLogger('providers.stays.fanout');

export interface StayFanoutFailure {
  readonly providerId: string;
  readonly message: string;
}

export interface StayFanoutResult {
  readonly stays: readonly CanonicalStay[];
  /** Raw per-provider offers, before merging, for diagnostics. */
  readonly offers: readonly StayOffer[];
  readonly failures: readonly StayFanoutFailure[];
  /** Providers that answered without error, whether or not they had results. */
  readonly answered: readonly string[];
}

export async function searchAllStays(
  providers: readonly StayProvider[],
  query: StayQuery,
  options: ProviderRequestOptions & { readonly limiter?: Limiter } = {},
): Promise<StayFanoutResult> {
  const { limiter, ...request } = options;

  const settled = await Promise.all(
    providers.map(async (provider) => {
      /*
       * The limiter wraps the leaf call, never the fan-out around it. A task
       * holding a slot while waiting for another deadlocks the moment every
       * slot is held by a waiter - the rule `concurrency.ts` states.
       */
      const run = () => provider.searchStays(query, request);

      try {
        const result = limiter ? await limiter.run(run) : await run();

        if (result.ok) return { provider, offers: result.value } as const;

        return { provider, error: result.error.publicMessage } as const;
      } catch (error) {
        // An adapter that throws instead of returning is an adapter bug, and
        // an adapter bug is not a reason to show the user nothing.
        log.warn(
          { providerId: provider.metadata.id, err: error },
          'stay adapter threw instead of returning a result',
        );

        return { provider, error: 'A stay provider returned an unexpected response.' } as const;
      }
    }),
  );

  const offers: StayOffer[] = [];
  const failures: StayFanoutFailure[] = [];
  const answered: string[] = [];

  for (const entry of settled) {
    if ('error' in entry) {
      failures.push({
        providerId: entry.provider.metadata.id,
        message: entry.error ?? 'Unknown failure.',
      });
      continue;
    }

    answered.push(entry.provider.metadata.id);
    offers.push(...entry.offers);
  }

  return { stays: canonicalise(offers), offers, failures, answered };
}

/**
 * Ask every provider that has one for its "find a stay" links.
 *
 * Kept apart from `searchAllStays` so a link is never counted as a result:
 * `stays.length` stays the number of priced places, and a page with only links
 * can say so. A provider that cannot answer is skipped, never fatal - a missing
 * link is a missing convenience, not a reason to fail the page.
 */
export async function findAllStayLinks(
  providers: readonly StayProvider[],
  query: StayQuery,
  options: ProviderRequestOptions & { readonly limiter?: Limiter } = {},
): Promise<readonly StayLinkOffer[]> {
  const { limiter, ...request } = options;

  const settled = await Promise.all(
    providers.map(async (provider) => {
      if (!provider.searchStayLinks) return [];

      const run = () => provider.searchStayLinks!(query, request);

      try {
        const result = limiter ? await limiter.run(run) : await run();
        return result.ok ? result.value : [];
      } catch (error) {
        log.warn(
          { providerId: provider.metadata.id, err: error },
          'stay link adapter threw instead of returning a result',
        );
        return [];
      }
    }),
  );

  return settled.flat();
}
