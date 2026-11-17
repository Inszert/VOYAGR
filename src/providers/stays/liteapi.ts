import { daysBetween } from '@/core/dates';
import { fromMajor, money, type Money } from '@/core/money';
import type {
  BoardType,
  StayOffer,
  StayPhoto,
  StayProperty,
  StayQuery,
  StayRate,
} from '@/core/stay/types';
import type { Env } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { err, ok } from '@/lib/result';
import type { FetchLike } from '../http/types';
import {
  liteapiHotelRowSchema,
  liteapiHotelsEnvelopeSchema,
  liteapiRatesEnvelopeSchema,
  liteapiRatesRowSchema,
  validateOffers,
} from '../schema';
import type { ProviderRequestOptions, ProviderResult } from '../types';
import type { StayProvider } from './types';

/**
 * Hotels and their rates from LiteAPI (docs.liteapi.travel, now served from
 * docs.nuitee.com), the owner's chosen hotel source. See `docs/provider-policy.md`.
 *
 * Two calls per search, both verified against the public reference:
 *
 * - `GET  https://api.liteapi.travel/v3.0/data/hotels` - hotels near a point
 *   (`latitude`, `longitude`, `radius` in metres, minimum 1000).
 * - `POST https://api.liteapi.travel/v3.0/hotels/rates` - rates for those hotel ids and
 *   the party's dates. Header `X-API-Key` on both.
 *
 * What a row honestly is:
 *
 * - **A price is the vendor's own figure.** The offer's `offerRetailRate` is the total for
 *   the stay; where it is absent the rates' own `retailRate.total` entries are summed
 *   (in one currency, with `Money`). Currency is whatever the vendor states. The per-night
 *   figure is the one place we divide: the vendor states a stay total only.
 * - **A hotel with no rate has no price.** It is returned with an empty `rates` list, which
 *   is "unknown", never zero.
 * - **Sandbox is `test`.** The rates response says `sandbox: true` for a sandbox key; those
 *   rates are provenance `test`, not `live`.
 * - **Photos** are the vendor's `main_photo`, only when it is an https URL.
 * - Children are not searched: the vendor needs each child's age and we do not hold one, and
 *   inventing an age would change the price. A party with children gets no priced stays here.
 */

const log = getLogger('providers.stays.liteapi');

export const LITEAPI_ID = 'liteapi';

const BASE_URL = 'https://api.liteapi.travel/v3.0';
const DEFAULT_RADIUS_KM = 10;
const DEFAULT_MAX_HOTELS = 40;
const HARD_MAX_HOTELS = 100;
const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * The rates call requires a guest nationality, and it can change the price.
 * We do not hold one, so it is an explicit, named default rather than a guess
 * buried in a request body.
 */
export const DEFAULT_GUEST_NATIONALITY = 'US';

const BOARD: Record<string, BoardType> = {
  RO: 'room_only',
  BB: 'breakfast',
  HB: 'half_board',
  FB: 'full_board',
  AI: 'all_inclusive',
};

export interface LiteApiOptions {
  readonly apiKey: string;
  readonly fetchImpl?: FetchLike;
  readonly now?: () => Date;
  readonly guestNationality?: string;
}

/** Null without a key: the adapter is then absent from the registry. */
export function createLiteApiStayProvider(
  env: Pick<Env, 'LITEAPI_API_KEY'>,
): LiteApiStayProvider | null {
  return env.LITEAPI_API_KEY ? new LiteApiStayProvider({ apiKey: env.LITEAPI_API_KEY }) : null;
}

/** A vendor decimal as exact minor units, or null when it cannot be one. */
export function toMoney(amount: number, currency: string): Money | null {
  try {
    return fromMajor(amount, currency);
  } catch {
    return null;
  }
}

function httpsOnly(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/** Spread the adults across the rooms, as evenly as whole people allow. */
function occupanciesFor(query: StayQuery): { adults: number }[] {
  const { adults, rooms } = query.occupancy;
  const count = Math.max(1, Math.min(rooms, adults));
  return Array.from({ length: count }, (_, index) => ({
    adults: Math.floor(adults / count) + (index < adults % count ? 1 : 0),
  }));
}

interface VendorAmount {
  amount: number;
  currency: string;
}

/** The vendor's stay total for one room type, as Money; null when it states none usable. */
function totalOf(roomType: {
  offerRetailRate?: VendorAmount | null;
  rates: { retailRate: { total: VendorAmount[] } }[];
}): Money | null {
  if (roomType.offerRetailRate) {
    return toMoney(roomType.offerRetailRate.amount, roomType.offerRetailRate.currency);
  }
  let total: Money | null = null;
  for (const rate of roomType.rates) {
    const stated = rate.retailRate.total[0];
    const part = stated ? toMoney(stated.amount, stated.currency) : null;
    if (!part) return null;
    if (total && total.currency !== part.currency) return null;
    total = total ? money(total.amount + part.amount, part.currency) : part;
  }
  return total;
}

export function mapProperty(row: ReturnType<typeof liteapiHotelRowSchema.parse>): StayProperty {
  const photo = httpsOnly(row.main_photo);
  const photos: StayPhoto[] = photo ? [{ url: photo, caption: null }] : [];
  const stars =
    typeof row.stars === 'number' && row.stars >= 1 && row.stars <= 5 ? row.stars : null;
  const rating =
    typeof row.rating === 'number' && row.rating > 0 && row.rating <= 10 ? row.rating : null;

  return {
    id: `${LITEAPI_ID}:${row.id}`,
    providerPropertyId: row.id,
    name: row.name,
    description: null,
    photos,
    address: {
      line: row.address?.trim() || null,
      city: row.city?.trim() || null,
      region: null,
      postcode: row.zip?.trim() || null,
      countryCode:
        row.country && /^[A-Za-z]{2}$/.test(row.country) ? row.country.toUpperCase() : null,
    },
    position: { latitude: row.latitude, longitude: row.longitude },
    starRating: stars,
    guestRating: rating
      ? { score: rating, scale: 10, outOfTen: rating, reviewCount: row.reviewCount ?? null }
      : null,
    amenities: [],
    propertyType: null,
  };
}

export class LiteApiStayProvider implements StayProvider {
  readonly metadata = {
    id: LITEAPI_ID,
    kind: 'stays',
    displayName: 'LiteAPI',
    isMock: false,
    mode: 'live',
    rateLimitPerMinute: null,
  } as const;

  private readonly apiKey: string;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => Date;
  private readonly guestNationality: string;

  constructor(options: LiteApiOptions) {
    if (!options.apiKey) {
      throw new AppError('CONFIGURATION_ERROR', 'The LiteAPI adapter needs LITEAPI_API_KEY.');
    }
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
    this.now = options.now ?? (() => new Date());
    this.guestNationality = options.guestNationality ?? DEFAULT_GUEST_NATIONALITY;
  }

  private async call(
    url: string,
    init: RequestInit,
    options?: ProviderRequestOptions,
  ): Promise<ProviderResult<unknown>> {
    const timeout = AbortSignal.timeout(options?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const signal = options?.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    try {
      const response = await this.fetchImpl(url, {
        ...init,
        headers: {
          Accept: 'application/json',
          ...(init.headers as Record<string, string> | undefined),
          'X-API-Key': this.apiKey,
        },
        signal,
      });
      if (!response.ok) {
        // Status only: never a header, never the key.
        log.warn({ status: response.status }, 'liteapi error status');
        const unavailable =
          response.status === 429 || response.status === 401 || response.status === 403;
        return err(
          new AppError(
            unavailable ? 'PROVIDER_UNAVAILABLE' : 'PROVIDER_ERROR',
            `LiteAPI responded with ${response.status}.`,
          ),
        );
      }
      return ok(await response.json());
    } catch (cause) {
      const timedOut = timeout.aborted;
      return err(
        new AppError(
          timedOut ? 'PROVIDER_TIMEOUT' : 'PROVIDER_ERROR',
          timedOut ? 'LiteAPI did not respond in time.' : 'LiteAPI could not be reached.',
          { cause },
        ),
      );
    }
  }

  async searchStays(
    query: StayQuery,
    options?: ProviderRequestOptions,
  ): Promise<ProviderResult<readonly StayOffer[]>> {
    const nights = daysBetween(query.checkIn, query.checkOut);
    if (nights < 1 || !query.destination.position) return ok([]);
    if (query.occupancy.children > 0) {
      log.info('liteapi skipped: children need ages we do not hold');
      return ok([]);
    }

    const limit = Math.min(query.maxResults ?? DEFAULT_MAX_HOTELS, HARD_MAX_HOTELS);
    const radiusMetres = Math.max(
      1000,
      Math.round((query.destination.radiusKm ?? DEFAULT_RADIUS_KM) * 1000),
    );

    const listUrl = new URL(`${BASE_URL}/data/hotels`);
    listUrl.searchParams.set('latitude', String(query.destination.position.latitude));
    listUrl.searchParams.set('longitude', String(query.destination.position.longitude));
    listUrl.searchParams.set('radius', String(radiusMetres));
    listUrl.searchParams.set('limit', String(limit));

    const listed = await this.call(listUrl.toString(), { method: 'GET' }, options);
    if (!listed.ok) return listed;

    const envelope = liteapiHotelsEnvelopeSchema.safeParse(listed.value);
    if (!envelope.success) {
      return err(new AppError('PROVIDER_ERROR', 'LiteAPI returned an unrecognised hotel list.'));
    }

    const hotels = validateOffers(liteapiHotelRowSchema, envelope.data.data);
    if (hotels.rejected.length > 0) {
      log.warn(
        { rejected: hotels.rejected },
        'liteapi hotel rows failed validation and were dropped',
      );
    }
    if (hotels.accepted.length === 0) return ok([]);

    const properties = new Map(hotels.accepted.map((row) => [row.id, mapProperty(row)]));

    // Rates are best effort: a failed rates call leaves hotels unpriced, not the search empty.
    const rated = await this.call(
      `${BASE_URL}/hotels/rates`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hotelIds: [...properties.keys()],
          checkin: query.checkIn,
          checkout: query.checkOut,
          currency: query.currency.toUpperCase(),
          guestNationality: this.guestNationality,
          occupancies: occupanciesFor(query),
        }),
      },
      options,
    );

    const ratesByHotel = new Map<string, StayRate[]>();
    if (!rated.ok) {
      log.warn(
        { code: rated.error.code },
        'liteapi rates unavailable; hotels listed without prices',
      );
    } else {
      const ratesEnvelope = liteapiRatesEnvelopeSchema.safeParse(rated.value);
      if (!ratesEnvelope.success) {
        log.warn('liteapi rates response unrecognised; hotels listed without prices');
      } else {
        const rows = validateOffers(liteapiRatesRowSchema, ratesEnvelope.data.data);
        if (rows.rejected.length > 0) {
          log.warn(
            { rejected: rows.rejected },
            'liteapi rate rows failed validation and were dropped',
          );
        }
        const sandbox = ratesEnvelope.data.sandbox === true;
        const observedAt = this.now().toISOString();

        for (const row of rows.accepted) {
          if (!properties.has(row.hotelId)) continue;
          const rates: StayRate[] = [];
          for (const roomType of row.roomTypes) {
            const total = totalOf(roomType);
            if (!total || total.amount <= 0) continue;
            const first = roomType.rates[0]!;
            const tag = first.cancellationPolicies?.refundableTag;
            rates.push({
              id: `${LITEAPI_ID}:${row.hotelId}:${roomType.offerId}`,
              providerRateId: roomType.offerId,
              providerRoomId: null,
              roomName: first.name?.trim() || null,
              bedConfiguration: null,
              board: first.boardType ? (BOARD[first.boardType.toUpperCase()] ?? null) : null,
              cancellation: {
                refundable: tag === 'RFN' ? true : tag === 'NRFN' ? false : null,
                deadline: null,
                description: null,
              },
              paymentTiming: null,
              benefits: [],
              total,
              // The vendor states a stay total only; the nightly figure is ours.
              perNight: money(Math.round(total.amount / nights), total.currency),
              base: null,
              taxesAndFees: null,
              occupancy: query.occupancy,
              observedAt,
              expiresAt: null,
              source: {
                part: 'stays',
                providerId: LITEAPI_ID,
                displayName: this.metadata.displayName,
                provenance: sandbox ? 'test' : 'live',
              },
            });
          }
          rates.sort((a, b) => a.total.amount - b.total.amount);
          if (rates.length > 0) ratesByHotel.set(row.hotelId, rates);
        }
      }
    }

    const offers: StayOffer[] = [...properties].map(([id, property]) => ({
      property,
      rates: ratesByHotel.get(id) ?? [],
    }));
    return ok(offers);
  }
}
