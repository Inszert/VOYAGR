import type { Money } from '../money';
import type { IsoDate, IsoDateTime } from '../trip/types';
import type { SourceAttribution } from '../trip/provenance';

/**
 * A place to stay, described in our own words rather than a vendor's.
 *
 * **Nothing in this file may be shaped by one provider.** The application and
 * the UI depend on this model; an adapter's job is to translate into it, and
 * a field that exists because Duffel happens to send it is a field the next
 * provider will have to fake. Where a vendor concept is genuinely universal -
 * a property, a room, a rate - it is kept as its own thing rather than
 * flattened, because flattening is what forces a rewrite when the second
 * provider arrives.
 *
 * **Absent is not zero and not false.** Every optional fact is `null`, and
 * `null` means "this provider did not tell us". No adapter may substitute a
 * default, and no screen may render a missing cancellation policy as
 * "non-refundable" - that is a claim about somebody's money.
 */

/** What a guest is fed. The union every provider is mapped onto. */
export type BoardType = 'room_only' | 'breakfast' | 'half_board' | 'full_board' | 'all_inclusive';

/** When money changes hands. `null` where the provider does not say. */
export type PaymentTiming = 'pay_now' | 'pay_later';

export interface StayPhoto {
  readonly url: string;
  /** Present only when the provider supplies one; never invented. */
  readonly caption: string | null;
}

export interface StayAddress {
  readonly line: string | null;
  readonly city: string | null;
  readonly region: string | null;
  readonly postcode: string | null;
  /** ISO 3166-1 alpha-2, upper case. */
  readonly countryCode: string | null;
}

export interface GeoPosition {
  readonly latitude: number;
  readonly longitude: number;
}

/**
 * A guest rating, kept with the scale it was given on.
 *
 * Providers score out of 5, 10 and 100. Storing only a normalised number
 * loses the ability to show what the vendor actually published, and storing
 * only the raw number makes two providers incomparable. So: both.
 */
export interface GuestRating {
  /** As the provider published it. */
  readonly score: number;
  /** The top of that provider's scale, e.g. `5`, `10`, `100`. */
  readonly scale: number;
  /** The same score out of ten, for comparing across providers. */
  readonly outOfTen: number;
  readonly reviewCount: number | null;
}

/**
 * A physical property.
 *
 * Deliberately free of anything about a stay: the same hotel is the same
 * hotel whichever dates, rates or provider it arrives through, and that is
 * what makes deduplication possible at all.
 */
export interface StayProperty {
  /**
   * Our id for this property from this provider.
   *
   * Not a canonical identity - see `canonicalKey` in `identity.ts`. Two
   * providers describing one hotel produce two of these.
   */
  readonly id: string;
  /** The provider's own id, kept so a later booking call can use it. */
  readonly providerPropertyId: string;
  readonly name: string;
  readonly description: string | null;
  readonly photos: readonly StayPhoto[];
  readonly address: StayAddress;
  readonly position: GeoPosition | null;
  /** Official star rating, 1-5, where the provider states one. */
  readonly starRating: number | null;
  readonly guestRating: GuestRating | null;
  readonly amenities: readonly string[];
  /** `hotel`, `apartment`, `hostel` - the provider's word, lower-cased. */
  readonly propertyType: string | null;
}

/** What it costs to cancel, and until when. */
export interface CancellationPolicy {
  /**
   * Whether the booking can be cancelled for a full refund at some point.
   *
   * `null` is its own case and must stay one: a provider that did not say is
   * not a provider that said no.
   */
  readonly refundable: boolean | null;
  /** The last instant a free cancellation is possible, when stated. */
  readonly deadline: IsoDateTime | null;
  /** The provider's own wording, for a tooltip. Never parsed for meaning. */
  readonly description: string | null;
}

/** How many people, in how many rooms. The shape of the stay being priced. */
export interface StayOccupancy {
  readonly adults: number;
  readonly children: number;
  readonly rooms: number;
}

/**
 * One bookable rate for one room at one property.
 *
 * The unit the user actually chooses, and the unit a price comparison
 * compares. Provider, room and rate stay distinct here because Duffel and
 * everyone else model them distinctly, and because a rate id is what a later
 * quote or booking call needs.
 */
export interface StayRate {
  readonly id: string;
  /** The provider's own rate id. Required for revalidation and booking. */
  readonly providerRateId: string;
  /** The provider's room id, where it has one separate from the rate. */
  readonly providerRoomId: string | null;
  readonly roomName: string | null;
  /** `1 double bed`, `2 singles`. The provider's wording. */
  readonly bedConfiguration: string | null;
  readonly board: BoardType | null;
  readonly cancellation: CancellationPolicy;
  readonly paymentTiming: PaymentTiming | null;
  /** Breakfast vouchers, late checkout, airport pickup - as published. */
  readonly benefits: readonly string[];

  /** Everything owed for the whole stay, as the provider quotes it. */
  readonly total: Money;
  /** The total divided by the nights. Arithmetic, never a second quote. */
  readonly perNight: Money;
  /** Before taxes and fees, where the provider separates them. */
  readonly base: Money | null;
  /** Taxes and fees, where separated. Never folded silently into the total. */
  readonly taxesAndFees: Money | null;

  readonly occupancy: StayOccupancy;

  /** When the provider said this was true. */
  readonly observedAt: IsoDateTime;
  /** When it stops being true, where the provider commits to a window. */
  readonly expiresAt: IsoDateTime | null;

  /** Which provider, and what its answer is worth. */
  readonly source: SourceAttribution;
}

/** One property and the rates one provider offered for it. */
export interface StayOffer {
  readonly property: StayProperty;
  readonly rates: readonly StayRate[];
}

/** What was asked for. Every rate is only meaningful against this. */
export interface StayQuery {
  /**
   * Where to look.
   *
   * A place rather than a string, so a provider that only takes coordinates
   * and one that only takes a city code are both satisfiable without the
   * caller knowing which it is talking to.
   */
  readonly destination: {
    /** IATA city or airport code, where the search came from a trip. */
    readonly code: string | null;
    readonly name: string | null;
    readonly position: GeoPosition | null;
    /** Kilometres around `position`. Providers that ignore it may. */
    readonly radiusKm: number | null;
  };
  readonly checkIn: IsoDate;
  readonly checkOut: IsoDate;
  readonly occupancy: StayOccupancy;
  /** The currency results should be quoted in, where the provider allows it. */
  readonly currency: string;
  readonly maxResults?: number;
}

/** Nights between two calendar dates. The only place this is computed. */
export function nightsIn(query: Pick<StayQuery, 'checkIn' | 'checkOut'>): number {
  const from = Date.UTC(
    Number(query.checkIn.slice(0, 4)),
    Number(query.checkIn.slice(5, 7)) - 1,
    Number(query.checkIn.slice(8, 10)),
  );
  const to = Date.UTC(
    Number(query.checkOut.slice(0, 4)),
    Number(query.checkOut.slice(5, 7)) - 1,
    Number(query.checkOut.slice(8, 10)),
  );

  return Math.round((to - from) / 86_400_000);
}
