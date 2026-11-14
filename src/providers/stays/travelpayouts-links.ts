import { daysBetween } from '@/core/dates';
import type { StayLinkOffer, StayOffer, StayQuery } from '@/core/stay/types';
import type { Env } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { err, ok } from '@/lib/result';
import { stayLinkOfferSchema, validateOffers } from '../schema';
import type { ProviderResult } from '../types';
import type { StayProvider } from './types';

/**
 * "Find a stay" links through Travelpayouts.
 *
 * Hotellook's API closed on 2025-10-20, so there is no hotel feed we can price
 * a night from. What the partner programme still gives us is an affiliate
 * redirect into a hotel vendor's own search, and that is all this adapter
 * produces: a link that already carries the destination, the dates and the
 * party. It quotes nothing. Every offer says `price: null`, the cost engine
 * reports the stay as an `excluded` line, and the page says the total is
 * flights only - a link is a place to look, never a price.
 *
 * Deterministic and offline: building a link is string work. The three
 * identifiers come from configuration, and without all of them the adapter
 * says it is unavailable instead of guessing one - a wrong programme id is a
 * link that earns nothing and says nothing.
 */

const log = getLogger('providers.stays.travelpayouts-links');

const REDIRECT = 'https://tp.media/r';
const VENDOR_SEARCH = 'https://www.booking.com/searchresults.html';

export const TRAVELPAYOUTS_LINKS_ID = 'travelpayouts-links';

export interface TravelpayoutsLinkConfig {
  /** The affiliate marker; `AVIASALES_PARTNER_ID` is the same account's. */
  readonly marker: string;
  readonly programId: string;
  readonly campaignId: string;
}

/** Null when any identifier is missing: the adapter is then unavailable. */
export function linkConfigFrom(
  env: Pick<
    Env,
    'AVIASALES_PARTNER_ID' | 'TRAVELPAYOUTS_HOTEL_PROGRAM_ID' | 'TRAVELPAYOUTS_HOTEL_CAMPAIGN_ID'
  >,
): TravelpayoutsLinkConfig | null {
  const marker = env.AVIASALES_PARTNER_ID;
  const programId = env.TRAVELPAYOUTS_HOTEL_PROGRAM_ID;
  const campaignId = env.TRAVELPAYOUTS_HOTEL_CAMPAIGN_ID;

  return marker && programId && campaignId ? { marker, programId, campaignId } : null;
}

/**
 * The partner link for one search.
 *
 * Returns null when the query names no place: a search with nowhere to look is
 * not worth sending a traveller to.
 */
export function buildStayLink(config: TravelpayoutsLinkConfig, query: StayQuery): string | null {
  const place = (query.destination.name ?? query.destination.code ?? '').trim();
  if (!place) return null;

  const search = new URL(VENDOR_SEARCH);
  search.searchParams.set('ss', place);
  search.searchParams.set('checkin', query.checkIn);
  search.searchParams.set('checkout', query.checkOut);
  search.searchParams.set('group_adults', String(query.occupancy.adults));
  search.searchParams.set('group_children', String(query.occupancy.children));
  search.searchParams.set('no_rooms', String(query.occupancy.rooms));

  // `URLSearchParams` encodes the vendor URL once, as the `u` value; encoding
  // it by hand as well would double-encode the `%` signs inside it.
  const redirect = new URL(REDIRECT);
  redirect.searchParams.set('marker', config.marker);
  redirect.searchParams.set('campaign_id', config.campaignId);
  redirect.searchParams.set('p', config.programId);
  redirect.searchParams.set('u', search.toString());

  return redirect.toString();
}

export class TravelpayoutsLinksProvider implements StayProvider {
  readonly metadata = {
    id: TRAVELPAYOUTS_LINKS_ID,
    kind: 'stays',
    displayName: 'Booking.com via Travelpayouts',
    isMock: false,
    // Real, but it answers "where to look", not "what it costs".
    mode: 'indicative',
    rateLimitPerMinute: null,
  } as const;

  constructor(private readonly config: TravelpayoutsLinkConfig | null) {}

  /** There are no priced stays to list: that is what this adapter is not. */
  async searchStays(): Promise<ProviderResult<readonly StayOffer[]>> {
    return ok([]);
  }

  async searchStayLinks(query: StayQuery): Promise<ProviderResult<readonly StayLinkOffer[]>> {
    if (!this.config) {
      return err(
        new AppError('PROVIDER_UNAVAILABLE', 'Travelpayouts hotel link identifiers are not set.', {
          publicMessage: 'Stay links are not available yet.',
        }),
      );
    }

    // A stay of no nights is not a search worth sending anybody to.
    if (daysBetween(query.checkIn, query.checkOut) < 1) return ok([]);

    const url = buildStayLink(this.config, query);
    if (!url) return ok([]);

    const offer: StayLinkOffer = {
      id: `${TRAVELPAYOUTS_LINKS_ID}:${query.destination.code ?? query.destination.name}:${query.checkIn}:${query.checkOut}`,
      providerId: this.metadata.id,
      displayName: this.metadata.displayName,
      destinationName: (query.destination.name ?? query.destination.code ?? '').trim(),
      checkIn: query.checkIn,
      checkOut: query.checkOut,
      occupancy: query.occupancy,
      price: null,
      url,
    };

    // The same boundary every provider's output crosses: a malformed offer is
    // dropped and reported rather than put in an href.
    const { accepted, rejected } = validateOffers(stayLinkOfferSchema, [offer]);
    if (rejected.length > 0) {
      log.warn({ rejected }, 'a stay link failed validation and was dropped');
    }

    return ok(accepted);
  }
}

export function createTravelpayoutsLinksProvider(env: Env): StayProvider {
  return new TravelpayoutsLinksProvider(linkConfigFrom(env));
}
