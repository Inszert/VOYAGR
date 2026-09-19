import type { Money } from '../money';

/**
 * Normalised trip domain types.
 *
 * These describe a trip *after* provider responses have been normalised, so the
 * scoring, cost and constraint engines never see provider-specific shapes. Adding
 * a provider means writing an adapter, not changing these types.
 */

/** ISO 8601 calendar date, `YYYY-MM-DD`. No time, no zone. */
export type IsoDate = string;

/**
 * ISO 8601 instant in UTC, `YYYY-MM-DDTHH:mm:ssZ`.
 *
 * A real moment on the world's timeline. Use it for "when did we observe this",
 * never for "when does the plane leave" - see `LocalDateTime`.
 */
export type IsoDateTime = string;

/**
 * Wall-clock date and time where the event happens, `YYYY-MM-DDTHH:mm:ss`.
 *
 * Deliberately *not* an instant and deliberately carrying no zone suffix. A
 * flight departs at 06:10 local at its origin and lands at 09:45 local at its
 * destination, which is how every airline and booking system publishes it, and
 * it is the only form in which "the return flight leaves at an unholy hour" is
 * a question that can be answered.
 *
 * Two consequences that make this the right type rather than a lazy one:
 *
 *  - Subtracting an arrival from a departure does **not** give a duration, and
 *    `FlightLeg.durationMinutes` exists because of it. Nothing in the codebase
 *    may compute a flight duration from these two fields.
 *  - Turning one of these into a `Date` is a bug: `new Date('2026-06-10T23:40')`
 *    is interpreted in the *server's* zone, which is neither the origin's nor
 *    the destination's. Read the clock face with `minutesIntoLocalDay` from
 *    `@/core/dates` instead.
 */
export type LocalDateTime = string;

/** IATA airport code, e.g. `VIE`. */
export type AirportCode = string;

/**
 * How much the system actually knows about a number.
 *
 * Specification section 10 requires every cost line to be tagged, and section
 * 31.11 requires the UI never to imply precision the data does not support.
 */
export type CostConfidence =
  /** Quoted by a provider for these exact conditions. */
  | 'known'
  /** Derived by our own model, e.g. a food budget or a transfer heuristic. */
  | 'estimated'
  /** Knowingly not counted; surfaced to the user rather than silently dropped. */
  | 'excluded';

export type CostCategory =
  | 'flight'
  | 'flight_fees'
  | 'hotel'
  | 'hotel_fees'
  | 'transfer'
  | 'local_transport'
  | 'food'
  | 'activities'
  | 'parking'
  | 'car_rental'
  | 'other';

export interface CostLine {
  readonly id: string;
  readonly category: CostCategory;
  readonly label: string;
  readonly amount: Money;
  readonly confidence: CostConfidence;
  /** Provider or model that produced the number, for traceability. */
  readonly source: string;
  /** When the figure was observed, for staleness checks. */
  readonly observedAt?: IsoDateTime;
  /** Conditions attached to the quote, e.g. `1 cabin bag, non-refundable`. */
  readonly conditions?: string;
}

export interface FlightSegment {
  readonly origin: AirportCode;
  readonly destination: AirportCode;
  /** Local wall-clock time at `origin`. */
  readonly departsAt: LocalDateTime;
  /** Local wall-clock time at `destination`. */
  readonly arrivesAt: LocalDateTime;
  readonly carrier: string;
  readonly flightNumber: string;
}

export interface FlightLeg {
  readonly segments: readonly FlightSegment[];
  /** Total travel time in minutes, including connections. */
  readonly durationMinutes: number;
  /*
   * These three are `boolean | null` rather than `boolean`, and the null is the
   * point. Not every provider reports a baggage allowance or says how a
   * connection is ticketed, and a missing answer collapsed into `false` becomes
   * a confident claim we never had grounds for - in exactly the fields the
   * No-Surprise check reads. `null` means the provider did not say, and every
   * engine treats that as its own case: unproven for a hard requirement,
   * worth flagging in a warning, and a drag on data confidence in the score.
   */
  readonly cabinBaggageIncluded: boolean | null;
  readonly checkedBaggageIncluded: boolean | null;
  /**
   * True when connections are sold on separate tickets, so a missed connection
   * is the traveller's problem. A material risk flagged in section 31.5, and
   * the one where a silent `false` is most expensive.
   */
  readonly selfTransfer: boolean | null;
}

export interface FlightOffer {
  readonly id: string;
  readonly providerId: string;
  readonly outbound: FlightLeg;
  readonly inbound: FlightLeg;
  /** Total price for all passengers, as quoted. */
  readonly price: Money;
  readonly observedAt: IsoDateTime;
  readonly deepLink?: string;
}

export interface HotelOffer {
  readonly id: string;
  readonly providerId: string;
  readonly name: string;
  readonly starRating: number | null;
  /** Guest review score normalised to 0-10, or null when unrated. */
  readonly reviewScore: number | null;
  readonly reviewCount: number;
  readonly distanceToBeachMetres: number | null;
  readonly distanceToCentreMetres: number | null;
  readonly boardType: 'room_only' | 'breakfast' | 'half_board' | 'full_board' | 'all_inclusive';
  readonly freeCancellation: boolean;
  /** Price for the whole stay, all guests, as quoted. */
  readonly totalPrice: Money;
  /** Taxes and fees not included in `totalPrice`, when the provider says so. */
  readonly excludedFees: Money | null;
  readonly observedAt: IsoDateTime;
  readonly deepLink?: string;
}

export interface TransferOffer {
  readonly id: string;
  readonly providerId: string;
  readonly mode: 'private' | 'shared' | 'public' | 'taxi' | 'walk';
  readonly durationMinutes: number;
  /** Price each way, for the whole party. */
  readonly pricePerDirection: Money;
  readonly observedAt: IsoDateTime;
}

export interface WeatherOutlook {
  readonly date: IsoDate;
  readonly temperatureMinC: number;
  readonly temperatureMaxC: number;
  readonly precipitationProbability: number;
  readonly windKph: number;
  readonly seaTemperatureC: number | null;
  /**
   * Forecast trust, 0-1. Long-range dates fall back to climatology and must not
   * be presented as a forecast (specification section 13).
   */
  readonly confidence: number;
}

export interface TripDates {
  readonly departureDate: IsoDate;
  readonly returnDate: IsoDate;
  readonly nights: number;
}

/** A fully assembled candidate trip, ready to cost, constrain and score. */
export interface TripCandidate {
  readonly id: string;
  readonly origin: AirportCode;
  readonly destination: AirportCode;
  readonly destinationName: string;
  readonly dates: TripDates;
  readonly passengers: number;
  readonly flight: FlightOffer;
  readonly hotel: HotelOffer;
  readonly transfer: TransferOffer | null;
  readonly weather: readonly WeatherOutlook[];
  /** Additional lines such as food budget or activities. */
  readonly extraCosts: readonly CostLine[];
}

export type OptimisationMode =
  | 'cheapest'
  | 'best_value'
  | 'nicest_within_budget'
  | 'maximise_beach_time'
  | 'maximise_hotel_quality'
  | 'maximise_food_quality'
  | 'maximise_exploration';

export type TravelStyle =
  | 'full_chill'
  | 'chill'
  | 'balanced'
  | 'explore'
  | 'culture'
  | 'food'
  | 'beach'
  | 'nightlife'
  | 'adventure'
  | 'luxury';

/**
 * The structured search profile.
 *
 * Natural language is parsed into this shape by the AI layer, but every field is
 * validated deterministically before it reaches the engines (section 23).
 */
export interface SearchProfile {
  readonly passengers: number;
  readonly origins: readonly AirportCode[];
  readonly minNights: number;
  readonly maxNights: number;
  readonly earliestDeparture: IsoDate;
  readonly latestReturn: IsoDate;
  /**
   * Days of the week a departure may fall on, 0 (Sunday) to 6 (Saturday).
   * Null means any day.
   *
   * This is what makes "a weekend" expressible. A weekend is not a shorter
   * travel window - it is a window plus a rule about which days inside it
   * count. Without this the planner would price a Tuesday departure and the
   * page would call it a weekend break.
   */
  readonly departureDaysOfWeek: readonly number[] | null;
  /** Days of the week a return may fall on. Null means any day. */
  readonly returnDaysOfWeek: readonly number[] | null;
  /** Target spend for a good trip. */
  readonly targetBudget: Money;
  /** Hard ceiling. Exceeding it makes a trip ineligible, not merely worse. */
  readonly maxBudget: Money;
  /** Amount deliberately held back for food and spontaneous spending. */
  readonly reserveBudget: Money | null;
  readonly travelStyle: TravelStyle;
  readonly optimisationMode: OptimisationMode;
  readonly requireDirectFlights: boolean;
  readonly requireCheckedBaggage: boolean;
  readonly requireFreeCancellation: boolean;
  readonly minHotelReviewScore: number | null;
  readonly maxBeachDistanceMetres: number | null;
}
