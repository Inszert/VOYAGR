import { greaterThan, subtract, type Money } from '../money';
import type { TripCost } from './cost';
import type { SearchProfile, TripCandidate } from './types';

/**
 * Hard eligibility rules (specification sections 4, 6 and 23).
 *
 * This module decides whether a trip is *allowed*, not whether it is *good*.
 * Scoring ranks eligible trips; this decides which trips exist at all.
 *
 * Nothing here is advisory and nothing here is delegated to the language model.
 * If the user set a maximum budget of EUR 850, a EUR 851 trip is ineligible -
 * no amount of model enthusiasm may overturn that.
 */

export type ConstraintCode =
  | 'OVER_MAX_BUDGET'
  | 'NIGHTS_BELOW_MINIMUM'
  | 'NIGHTS_ABOVE_MAXIMUM'
  | 'DEPARTURE_BEFORE_WINDOW'
  | 'RETURN_AFTER_WINDOW'
  | 'ORIGIN_NOT_ALLOWED'
  | 'PASSENGER_COUNT_MISMATCH'
  | 'DIRECT_FLIGHT_REQUIRED'
  | 'CHECKED_BAGGAGE_REQUIRED'
  | 'FREE_CANCELLATION_REQUIRED'
  | 'HOTEL_REVIEW_SCORE_TOO_LOW'
  | 'BEACH_TOO_FAR';

export interface ConstraintViolation {
  readonly code: ConstraintCode;
  /** Plain-language explanation, safe to show the user. */
  readonly message: string;
  /** Machine-readable detail for the UI, e.g. by how much a budget was missed. */
  readonly detail?: Record<string, string | number | boolean>;
}

export interface EligibilityResult {
  readonly eligible: boolean;
  readonly violations: readonly ConstraintViolation[];
  /** Budget headroom against the maximum. Negative when over budget. */
  readonly budgetHeadroom: Money;
  /** Headroom against the target budget, before any reserve is set aside. */
  readonly targetHeadroom: Money;
  /**
   * Money free to spend on upgrades: headroom against the target, minus any
   * reserve the user asked to keep back (section 31.6).
   */
  readonly discretionaryBudget: Money;
}

function isDirect(candidate: TripCandidate): boolean {
  return (
    candidate.flight.outbound.segments.length === 1 &&
    candidate.flight.inbound.segments.length === 1
  );
}

/**
 * Evaluate every hard rule against a costed candidate.
 *
 * All violations are collected rather than short-circuiting on the first one,
 * so the UI can explain everything that is wrong with a near-miss trip instead
 * of revealing the problems one at a time.
 */
export function evaluateEligibility(
  candidate: TripCandidate,
  cost: TripCost,
  profile: SearchProfile,
): EligibilityResult {
  const violations: ConstraintViolation[] = [];

  // --- Budget -------------------------------------------------------------
  if (greaterThan(cost.total, profile.maxBudget)) {
    const overBy = subtract(cost.total, profile.maxBudget);
    violations.push({
      code: 'OVER_MAX_BUDGET',
      message: 'The total cost exceeds the maximum budget.',
      detail: {
        totalMinorUnits: cost.total.amount,
        maxBudgetMinorUnits: profile.maxBudget.amount,
        overByMinorUnits: overBy.amount,
        currency: cost.total.currency,
      },
    });
  }

  // --- Duration -----------------------------------------------------------
  if (candidate.dates.nights < profile.minNights) {
    violations.push({
      code: 'NIGHTS_BELOW_MINIMUM',
      message: `The trip is ${candidate.dates.nights} nights, shorter than the ${profile.minNights} night minimum.`,
      detail: { nights: candidate.dates.nights, minNights: profile.minNights },
    });
  }

  if (candidate.dates.nights > profile.maxNights) {
    violations.push({
      code: 'NIGHTS_ABOVE_MAXIMUM',
      message: `The trip is ${candidate.dates.nights} nights, longer than the ${profile.maxNights} night maximum.`,
      detail: { nights: candidate.dates.nights, maxNights: profile.maxNights },
    });
  }

  // --- Date window --------------------------------------------------------
  // ISO dates compare correctly as strings, which avoids timezone drift from
  // parsing a calendar date into a Date object.
  if (candidate.dates.departureDate < profile.earliestDeparture) {
    violations.push({
      code: 'DEPARTURE_BEFORE_WINDOW',
      message: 'Departure falls before the earliest acceptable date.',
      detail: {
        departureDate: candidate.dates.departureDate,
        earliestDeparture: profile.earliestDeparture,
      },
    });
  }

  if (candidate.dates.returnDate > profile.latestReturn) {
    violations.push({
      code: 'RETURN_AFTER_WINDOW',
      message: 'Return falls after the latest acceptable date.',
      detail: { returnDate: candidate.dates.returnDate, latestReturn: profile.latestReturn },
    });
  }

  // --- Origin and party ---------------------------------------------------
  if (profile.origins.length > 0 && !profile.origins.includes(candidate.origin)) {
    violations.push({
      code: 'ORIGIN_NOT_ALLOWED',
      message: `Departs from ${candidate.origin}, which is not among the selected departure airports.`,
      detail: { origin: candidate.origin, allowed: profile.origins.join(', ') },
    });
  }

  if (candidate.passengers !== profile.passengers) {
    violations.push({
      code: 'PASSENGER_COUNT_MISMATCH',
      message: 'The trip was priced for a different number of travellers.',
      detail: { candidate: candidate.passengers, requested: profile.passengers },
    });
  }

  // --- Explicit user requirements ----------------------------------------
  if (profile.requireDirectFlights && !isDirect(candidate)) {
    violations.push({
      code: 'DIRECT_FLIGHT_REQUIRED',
      message: 'Direct flights were required, but this itinerary has a connection.',
      detail: {
        outboundSegments: candidate.flight.outbound.segments.length,
        inboundSegments: candidate.flight.inbound.segments.length,
      },
    });
  }

  if (
    profile.requireCheckedBaggage &&
    !(
      candidate.flight.outbound.checkedBaggageIncluded &&
      candidate.flight.inbound.checkedBaggageIncluded
    )
  ) {
    violations.push({
      code: 'CHECKED_BAGGAGE_REQUIRED',
      message: 'Checked baggage was required, but it is not included on both legs.',
    });
  }

  if (profile.requireFreeCancellation && !candidate.hotel.freeCancellation) {
    violations.push({
      code: 'FREE_CANCELLATION_REQUIRED',
      message: 'Free cancellation was required, but this rate is non-refundable.',
    });
  }

  if (
    profile.minHotelReviewScore !== null &&
    candidate.hotel.reviewScore !== null &&
    candidate.hotel.reviewScore < profile.minHotelReviewScore
  ) {
    violations.push({
      code: 'HOTEL_REVIEW_SCORE_TOO_LOW',
      message: `The hotel scores ${candidate.hotel.reviewScore}, below the required ${profile.minHotelReviewScore}.`,
      detail: {
        reviewScore: candidate.hotel.reviewScore,
        required: profile.minHotelReviewScore,
      },
    });
  }

  if (
    profile.maxBeachDistanceMetres !== null &&
    candidate.hotel.distanceToBeachMetres !== null &&
    candidate.hotel.distanceToBeachMetres > profile.maxBeachDistanceMetres
  ) {
    violations.push({
      code: 'BEACH_TOO_FAR',
      message: `The hotel is ${candidate.hotel.distanceToBeachMetres} m from the beach, beyond the ${profile.maxBeachDistanceMetres} m limit.`,
      detail: {
        distanceToBeachMetres: candidate.hotel.distanceToBeachMetres,
        maxBeachDistanceMetres: profile.maxBeachDistanceMetres,
      },
    });
  }

  const budgetHeadroom = subtract(profile.maxBudget, cost.total);
  const targetHeadroom = subtract(profile.targetBudget, cost.total);
  const discretionaryBudget = profile.reserveBudget
    ? subtract(targetHeadroom, profile.reserveBudget)
    : targetHeadroom;

  return {
    eligible: violations.length === 0,
    violations,
    budgetHeadroom,
    targetHeadroom,
    discretionaryBudget,
  };
}

/**
 * Risks and hidden costs that do not make a trip ineligible but that the user
 * should see before acting (the No-Surprise Travel Check, section 31.5).
 *
 * Kept separate from eligibility on purpose: a warning must never quietly filter
 * a trip out, and a hard rule must never be downgraded to a warning.
 */
export type TravelWarningCode =
  | 'SELF_TRANSFER_RISK'
  | 'CABIN_BAGGAGE_ONLY'
  | 'LATE_ARRIVAL'
  | 'EARLY_DEPARTURE'
  | 'LONG_TRANSFER'
  | 'NON_REFUNDABLE'
  | 'EXCLUDED_FEES'
  | 'ESTIMATE_HEAVY_TOTAL'
  | 'NO_TRANSFER_PRICED'
  | 'LOW_WEATHER_CONFIDENCE';

export type WarningSeverity = 'confirmed' | 'estimated' | 'possible' | 'needs_verification';

export interface TravelWarning {
  readonly code: TravelWarningCode;
  readonly severity: WarningSeverity;
  readonly message: string;
}

const LATE_ARRIVAL_HOUR = 23;
const EARLY_DEPARTURE_HOUR = 6;
const LONG_TRANSFER_MINUTES = 75;
const ESTIMATE_HEAVY_THRESHOLD = 0.6;
const LOW_WEATHER_CONFIDENCE = 0.5;

/** Hour-of-day in the local timestamp string, without timezone conversion. */
function hourOf(isoDateTime: string): number {
  const hour = Number.parseInt(isoDateTime.slice(11, 13), 10);
  return Number.isNaN(hour) ? -1 : hour;
}

export function detectTravelWarnings(candidate: TripCandidate, cost: TripCost): TravelWarning[] {
  const warnings: TravelWarning[] = [];
  const { outbound, inbound } = candidate.flight;

  if (outbound.selfTransfer || inbound.selfTransfer) {
    warnings.push({
      code: 'SELF_TRANSFER_RISK',
      severity: 'confirmed',
      message:
        'Connections are booked on separate tickets. A missed connection is not protected by the airline.',
    });
  }

  if (!outbound.checkedBaggageIncluded || !inbound.checkedBaggageIncluded) {
    warnings.push({
      code: 'CABIN_BAGGAGE_ONLY',
      severity: 'confirmed',
      message: 'Checked baggage is not included. Adding a bag will increase the total.',
    });
  }

  const arrivalSegment = outbound.segments.at(-1);
  if (arrivalSegment && hourOf(arrivalSegment.arrivesAt) >= LATE_ARRIVAL_HOUR) {
    warnings.push({
      code: 'LATE_ARRIVAL',
      severity: 'confirmed',
      message:
        'Arrival is late at night. Check that the hotel reception and transfer still operate.',
    });
  }

  const departureSegment = inbound.segments[0];
  if (departureSegment && hourOf(departureSegment.departsAt) < EARLY_DEPARTURE_HOUR) {
    warnings.push({
      code: 'EARLY_DEPARTURE',
      severity: 'confirmed',
      message: 'The return flight departs very early, which shortens the last day.',
    });
  }

  if (candidate.transfer && candidate.transfer.durationMinutes > LONG_TRANSFER_MINUTES) {
    warnings.push({
      code: 'LONG_TRANSFER',
      severity: 'estimated',
      message: `The airport transfer takes about ${candidate.transfer.durationMinutes} minutes each way.`,
    });
  }

  if (!candidate.transfer) {
    warnings.push({
      code: 'NO_TRANSFER_PRICED',
      severity: 'needs_verification',
      message: 'No airport transfer was priced, so the real total is likely higher than shown.',
    });
  }

  if (!candidate.hotel.freeCancellation) {
    warnings.push({
      code: 'NON_REFUNDABLE',
      severity: 'confirmed',
      message: 'The hotel rate is non-refundable.',
    });
  }

  if (candidate.hotel.excludedFees && candidate.hotel.excludedFees.amount > 0) {
    warnings.push({
      code: 'EXCLUDED_FEES',
      severity: 'estimated',
      message: 'The property charges taxes or fees on arrival that are not in the quoted rate.',
    });
  }

  if (cost.knownShare < ESTIMATE_HEAVY_THRESHOLD) {
    warnings.push({
      code: 'ESTIMATE_HEAVY_TOTAL',
      severity: 'estimated',
      message: 'Much of this total is estimated rather than quoted. Treat it as indicative.',
    });
  }

  const weakForecast = candidate.weather.some((day) => day.confidence < LOW_WEATHER_CONFIDENCE);
  if (weakForecast) {
    warnings.push({
      code: 'LOW_WEATHER_CONFIDENCE',
      severity: 'possible',
      message:
        'These dates are far enough out that the weather outlook is seasonal, not a forecast.',
    });
  }

  return warnings;
}
