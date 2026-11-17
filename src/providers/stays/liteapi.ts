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
import { liteApiEnvironment, type Env } from '@/lib/env';
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
  env: Pick<Env, 'LITEAPI_API_KEY'> & Partial<Pick<Env, 'LITEAPI_GUEST_NATIONALITY'>>,
): LiteApiStayProvider | null {
  if (!env.LITEAPI_API_KEY) return null;
  log.info({ mode: liteApiEnvironment(env) }, 'liteapi stay provider enabled');
  return new LiteApiStayProvider({
    apiKey: env.LITEAPI_API_KEY,
    ...(env.LITEAPI_GUEST_NATIONALITY ? { guestNationality: env.LITEAPI_GUEST_NATIONALITY } : {}),
  });
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

interface VendorTax {
  included: boolean;
  amount: number;
  currency: string;
}

/** Sum one class of vendor amounts in a single currency. Zero or mixed currency is `null`. */
function sumSameCurrency(amounts: readonly VendorAmount[], what: string): Money | null {
  let total: Money | null = null;
  for (const entry of amounts) {
    const part = toMoney(entry.amount, entry.currency);
    if (!part) return null;
    if (total && total.currency !== part.currency) {
      log.warn({ what }, 'liteapi tax amounts in mixed currencies; left unstated');
      return null;
    }
    total = total ? money(total.amount + part.amount, part.currency) : part;
  }
  // A sum of nothing is "not stated", not a claim that nothing is owed.
  return total && total.amount > 0 ? total : null;
}

/**
 * Split the vendor's tax list into what is already in the total and what is paid at the
 * property. Nothing here touches the stay total. A rate with no tax list, or a malformed one,
 * leaves both `null`: unknown, never zero. For a room type with several rates (several rooms)
 * every rate must state its list, or neither figure is claimed.
 */
export function splitTaxes(
  rates: readonly { retailRate: { taxesAndFees?: readonly VendorTax[] | null } }[],
): { included: Money | null; payableAtProperty: Money | null } {
  const lists = rates.map((rate) => rate.retailRate.taxesAndFees);
  if (lists.length === 0 || lists.some((list) => !list || list.length === 0)) {
    return { included: null, payableAtProperty: null };
  }
  const all = lists.flatMap((list) => list ?? []);
  return {
    included: sumSameCurrency(
      all.filter((tax) => tax.included),
      'included',
    ),
    payableAtProperty: sumSameCurrency(
      all.filter((tax) => !tax.included),
      'payable_at_property',
    ),
  };
}

/** `2026-07-30 02:00:00` (the vendor's sample, always GMT) as an instant; null if not that shape. */
export function cancelTimeToInstant(value: string): string | null {
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.\d+)?(?:Z)?$/.exec(value.trim());
  if (!match) return null;
  const instant = `${match[1]}T${match[2]}Z`;
  return Number.isNaN(Date.parse(instant)) ? null : instant;
}

/** The earliest stated free-cancellation deadline across the rates, or null. */
function freeCancellationDeadline(
  rates: readonly {
    cancellationPolicies?: { cancelPolicyInfos?: readonly { cancelTime: string }[] | null } | null;
  }[],
): string | null {
  const instants = rates
    .flatMap((rate) => rate.cancellationPolicies?.cancelPolicyInfos ?? [])
    .map((info) => cancelTimeToInstant(info.cancelTime))
    .filter((value): value is string => value !== null)
    .sort();
  return instants[0] ?? null;
}

/**
 * Only the two values the vendor's own samples show are mapped: `PROPERTY_PAY` is paid at the
 * property, `NUITEE_PAY` is paid now. The documentation lists no enum, so any other value, or a
 * mix, leaves the timing unknown.
 */
export function paymentTimingOf(
  rates: readonly { paymentTypes?: readonly string[] | null }[],
): 'pay_now' | 'pay_later' | null {
  const types = new Set(rates.flatMap((rate) => rate.paymentTypes ?? []));
  if (types.size === 1 && types.has('PROPERTY_PAY')) return 'pay_later';
  if (types.size === 1 && types.has('NUITEE_PAY')) return 'pay_now';
  return null;
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

  /**
   * Hotels near a point: one `data/hotels` call, schema-checked, mapped to properties.
   * An empty list is a real answer (nothing listed), not a failure. Children are not
   * searched here either, so a party with children, or a query with no position, is empty.
   */
  async listHotels(
    query: StayQuery,
    options?: ProviderRequestOptions,
  ): Promise<ProviderResult<readonly StayProperty[]>> {
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

    return ok(hotels.accepted.map((row) => mapProperty(row)));
  }

  /**
   * Rates for known hotel ids: one `hotels/rates` call, schema-checked and mapped. A hotel
   * with no usable rate is absent from the map, which is "unknown", never zero. `observedAt`
   * is the instant of this call.
   */
  async fetchRates(
    hotelIds: readonly string[],
    query: StayQuery,
    options?: ProviderRequestOptions,
  ): Promise<ProviderResult<ReadonlyMap<string, readonly StayRate[]>>> {
    const nights = daysBetween(query.checkIn, query.checkOut);
    const wanted = new Set(hotelIds);
    const ratesByHotel = new Map<string, StayRate[]>();
    if (nights < 1 || wanted.size === 0 || query.occupancy.children > 0) return ok(ratesByHotel);

    const rated = await this.call(
      `${BASE_URL}/hotels/rates`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hotelIds: [...wanted],
          checkin: query.checkIn,
          checkout: query.checkOut,
          currency: query.currency.toUpperCase(),
          guestNationality: this.guestNationality,
          occupancies: occupanciesFor(query),
        }),
      },
      options,
    );
    if (!rated.ok) return rated;

    const ratesEnvelope = liteapiRatesEnvelopeSchema.safeParse(rated.value);
    if (!ratesEnvelope.success) {
      return err(
        new AppError('PROVIDER_ERROR', 'LiteAPI returned an unrecognised rates response.'),
      );
    }

    const rows = validateOffers(liteapiRatesRowSchema, ratesEnvelope.data.data);
    if (rows.rejected.length > 0) {
      log.warn({ rejected: rows.rejected }, 'liteapi rate rows failed validation and were dropped');
    }
    const sandbox = ratesEnvelope.data.sandbox === true;
    const observedAt = this.now().toISOString();

    for (const row of rows.accepted) {
      if (!wanted.has(row.hotelId)) continue;
      const rates: StayRate[] = [];
      for (const roomType of row.roomTypes) {
        const total = totalOf(roomType);
        if (!total || total.amount <= 0) continue;
        const first = roomType.rates[0]!;
        const tag = first.cancellationPolicies?.refundableTag;
        const refundable = tag === 'RFN' ? true : tag === 'NRFN' ? false : null;
        const taxes = splitTaxes(roomType.rates);
        rates.push({
          id: `${LITEAPI_ID}:${row.hotelId}:${roomType.offerId}`,
          providerRateId: roomType.offerId,
          providerRoomId: null,
          roomName: first.name?.trim() || null,
          bedConfiguration: null,
          board: first.boardType ? (BOARD[first.boardType.toUpperCase()] ?? null) : null,
          cancellation: {
            refundable,
            // A deadline is only meaningful for a refundable rate.
            deadline: refundable === true ? freeCancellationDeadline(roomType.rates) : null,
            description: null,
          },
          paymentTiming: paymentTimingOf(roomType.rates),
          benefits: [],
          total,
          // The vendor states a stay total only; the nightly figure is ours.
          perNight: money(Math.round(total.amount / nights), total.currency),
          base: null,
          // Already inside `total`: information, not an addition.
          taxesAndFees: taxes.included,
          // Paid to the hotel. Never part of `total`.
          payableAtProperty: taxes.payableAtProperty,
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

    return ok(ratesByHotel);
  }

  /** The two leaf calls, composed. Behaviour is the original single-method search. */
  async searchStays(
    query: StayQuery,
    options?: ProviderRequestOptions,
  ): Promise<ProviderResult<readonly StayOffer[]>> {
    const listed = await this.listHotels(query, options);
    if (!listed.ok) return listed;
    if (listed.value.length === 0) return ok([]);

    // Rates are best effort: a failed rates call leaves hotels unpriced, not the search empty.
    const rated = await this.fetchRates(
      listed.value.map((property) => property.providerPropertyId),
      query,
      options,
    );
    if (!rated.ok) {
      log.warn(
        { code: rated.error.code },
        'liteapi rates unavailable; hotels listed without prices',
      );
    }
    const ratesByHotel = rated.ok ? rated.value : new Map<string, readonly StayRate[]>();

    return ok(
      listed.value.map((property) => ({
        property,
        rates: ratesByHotel.get(property.providerPropertyId) ?? [],
      })),
    );
  }
}
