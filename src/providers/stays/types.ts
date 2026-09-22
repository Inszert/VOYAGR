import type { StayOffer, StayQuery } from '@/core/stay/types';
import type { ProviderMetadata, ProviderRequestOptions, ProviderResult } from '../types';

/**
 * What every place-to-stay provider must be able to do, and nothing more.
 *
 * Kept to the smallest surface that a metasearch actually needs, because
 * every method added here is a method the next provider has to implement or
 * fake. Notably absent:
 *
 * - **No calendar method.** Most providers price exact dates and nothing
 *   else. Date exploration is built on top by asking several times - see
 *   `src/search/stays/calendar.ts` - so a provider that happens to have a
 *   calendar endpoint is an optimisation, never a requirement.
 * - **No booking.** Not in scope, and putting it here would force every
 *   adapter to stub it.
 *
 * An adapter returns `Result` rather than throwing, so one provider failing
 * degrades a fan-out instead of emptying it.
 */
export interface StayProvider {
  readonly metadata: ProviderMetadata & { kind: 'stays' };

  /**
   * Offers for one exact stay.
   *
   * Returns properties with their rates, already normalised. The caller does
   * not know and must not care which vendor answered.
   */
  searchStays(
    query: StayQuery,
    options?: ProviderRequestOptions,
  ): Promise<ProviderResult<readonly StayOffer[]>>;

  /**
   * Re-price one rate the user is looking at.
   *
   * Optional because not every provider supports it. Where it exists it is
   * what turns "this price may have moved" into a fact before anybody is
   * asked to pay - see `src/core/stay/freshness` usage in the search layer.
   * Returns `null` when the rate no longer exists at all.
   */
  revalidateRate?(
    providerRateId: string,
    options?: ProviderRequestOptions,
  ): Promise<ProviderResult<StayOffer | null>>;
}
