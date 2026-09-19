import type { PageCursor, ProviderPage } from './types';
import type { Result } from '@/lib/result';
import type { AppError } from '@/lib/errors';

/**
 * Walking a provider's pages.
 *
 * One place, so every adapter pages the same way and every caller gets the
 * same bounded behaviour. Both bounds matter: a page count stops an adapter
 * whose cursor never becomes null from looping forever, and an item count
 * stops a generous provider from being asked for more than the search will
 * use.
 */

export interface CollectOptions {
  /** Stop once this many items have been gathered. */
  readonly maxItems: number;
  /** Stop after this many requests, however many items came back. */
  readonly maxPages: number;
}

export interface CollectResult<T> {
  readonly items: readonly T[];
  readonly pagesFetched: number;
  /** True when a further page existed but a bound stopped us. */
  readonly truncated: boolean;
}

/**
 * Fetch pages until a bound is reached or the provider runs out.
 *
 * Stops on the first failed page and returns what it already had. A second
 * page failing must not discard a usable first one - a partial result set is
 * degraded, which the search already knows how to report, while an empty one
 * looks like "nothing exists".
 */
export async function collectPages<T>(
  fetchPage: (cursor: PageCursor | undefined) => Promise<Result<ProviderPage<T>, AppError>>,
  options: CollectOptions,
): Promise<{ result: CollectResult<T>; error: AppError | null }> {
  const items: T[] = [];
  let cursor: PageCursor | undefined;
  let pagesFetched = 0;

  for (let page = 0; page < options.maxPages; page += 1) {
    const outcome = await fetchPage(cursor);

    if (!outcome.ok) {
      return {
        result: { items, pagesFetched, truncated: true },
        error: outcome.error,
      };
    }

    pagesFetched += 1;
    items.push(...outcome.value.items);

    const nextCursor = outcome.value.nextCursor;

    if (!nextCursor) {
      return { result: { items, pagesFetched, truncated: false }, error: null };
    }

    if (items.length >= options.maxItems) {
      // A page remained, so the caller is looking at a bounded view rather
      // than everything the provider had.
      return { result: { items, pagesFetched, truncated: true }, error: null };
    }

    cursor = nextCursor;
  }

  return { result: { items, pagesFetched, truncated: true }, error: null };
}
