import { dayOfWeek, localHour } from '../dates';
import { greaterThan, subtract, type Money } from '../money';
import type { TripCost } from './cost';
import { connectionCount } from './legs';
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
  | 'DEPARTURE_DAY_NOT_ALLOWED'
  | 'RETURN_DAY_NOT_ALLOWED'
  | 'ORIGIN_NOT_ALLOWED'
  | 'PASSENGER_COUNT_MISMATCH'
  | 'DIRECT_FLIGHT_REQUIRED'
  | 'TOO_MANY_STOPS'
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

/**
 * Combine a per-leg fact into a trip-level one.
 *
 * `false` beats `null` beats `true`: a confirmed absence on either leg settles
 * it, and an unstated allowance on either leg leaves the trip unstated even if
 * the other leg was explicit.
 */
function bothLegs(outbound: boolean | null, inbound: boolean | null): boolean | null {
  if (outbound === false || inbound === false) return false;
  if (outbound === null || inbound === null) return null;
  return true;
}

/** Indexed by `dayOfWeek`, so 0 is Sunday. */
const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

function isDirect(candidate: TripCandidate): boolean {
  return (
    connectionCount(candidate.flight.outbound) === 0 &&
    connectionCount(candidate.flight.inbound) === 0
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

  /*
   * Checked here as well as in the planner, because the planner is not the
   * only thing that produces a candidate. A Travel Watch re-check runs a
   * stored profile against a freshly fetched trip, and a user who narrowed
   * "any week in June" to "weekends only" must stop being alerted about the
   * Tuesday departure that watch was created from.
   */
  if (
    profile.departureDaysOfWeek !== null &&
    !profile.departureDaysOfWeek.includes(dayOfWeek(candidate.dates.departureDate))
  ) {
    violations.push({
      code: 'DEPARTURE_DAY_NOT_ALLOWED',
      message: `Departs on a ${DAY_NAMES[dayOfWeek(candidate.dates.departureDate)]}, which is not one of the days you chose.`,
      detail: {
        departureDate: candidate.dates.departureDate,
        allowedDays: profile.departureDaysOfWeek.join(','),
      },
    });
  }

  if (
    profile.returnDaysOfWeek !== null &&
    !profile.returnDaysOfWeek.includes(dayOfWeek(candidate.dates.returnDate))
  ) {
    violations.push({
      code: 'RETURN_DAY_NOT_ALLOWED',
      message: `Returns on a ${DAY_NAMES[dayOfWeek(candidate.dates.returnDate)]}, which is not one of the days you chose.`,
      detail: {
        returnDate: candidate.dates.returnDate,
        allowedDays: profile.returnDaysOfWeek.join(','),
      },
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
        outboundSegments: connectionCount(candidate.flight.outbound) + 1,
        inboundSegments: connectionCount(candidate.flight.inbound) + 1,
      },
    });
  }

  if (profile.maxStops !== null && profile.maxStops !== undefined) {
    // The busier leg is what "two stops" means to a traveller.
    const stops = Math.max(
      connectionCount(candidate.flight.outbound),
      connectionCount(candidate.flight.inbound),
    );

    if (stops > profile.maxStops) {
      violations.push({
        code: 'TOO_MANY_STOPS',
        message: `This itinerary has ${stops} ${stops === 1 ? 'stop' : 'stops'} on a leg, and ${profile.maxStops} ${profile.maxStops === 1 ? 'is' : 'are'} the most you allowed.`,
        detail: { stops, maxStops: profile.maxStops },
      });
    }
  }

  if (profile.requireCheckedBaggage) {
    const included = bothLegs(
      candidate.flight.outbound.checkedBaggageIncluded,
      candidate.flight.inbound.checkedBaggageIncluded,
    );

    // Unknown is not a pass. A hard requirement we cannot show is met must not
    // be reported as met - but the message says which of the two it is, because
    // "the airline does not include it" and "the provider did not tell us" are
    // different problems with different fixes.
    if (included !== true) {
      violations.push({
        code: 'CHECKED_BAGGAGE_REQUIRED',
        message:
          included === false
            ? 'Checked baggage was required, but it is not included on both legs.'
            : 'Checked baggage was required, and this provider did not state the allowance.',
        detail: { confirmed: included === false },
      });
    }
  }

  const { hotel } = candidate;

  if (hotel === null) {
    // No priced stay means nothing is known about the hotel. A hard requirement
    // we cannot show is met is reported as unmet, with `confirmed: false` so the
    // reader can tell "no stay was priced" from "the stay fails it".
    if (profile.requireFreeCancellation) {
      violations.push({
        code: 'FREE_CANCELLATION_REQUIRED',
        message: 'Free cancellation was required, and no priced stay is available to check.',
        detail: { confirmed: false },
      });
    }

    if (profile.minHotelReviewScore !== null) {
      violations.push({
        code: 'HOTEL_REVIEW_SCORE_TOO_LOW',
        message: `A hotel review score of ${profile.minHotelReviewScore} was required, and no priced stay is available to check.`,
        detail: { required: profile.minHotelReviewScore, confirmed: false },
      });
    }

    if (profile.maxBeachDistanceMetres !== null) {
      violations.push({
        code: 'BEACH_TOO_FAR',
        message: `A stay within ${profile.maxBeachDistanceMetres} m of the beach was required, and no priced stay is available to check.`,
        detail: { maxBeachDistanceMetres: profile.maxBeachDistanceMetres, confirmed: false },
      });
    }
  } else {
    if (profile.requireFreeCancellation && !hotel.freeCancellation) {
      violations.push({
        code: 'FREE_CANCELLATION_REQUIRED',
        message: 'Free cancellation was required, but this rate is non-refundable.',
      });
    }

    if (
      profile.minHotelReviewScore !== null &&
      hotel.reviewScore !== null &&
      hotel.reviewScore < profile.minHotelReviewScore
    ) {
      violations.push({
        code: 'HOTEL_REVIEW_SCORE_TOO_LOW',
        message: `The hotel scores ${hotel.reviewScore}, below the required ${profile.minHotelReviewScore}.`,
        detail: {
          reviewScore: hotel.reviewScore,
          required: profile.minHotelReviewScore,
        },
      });
    }

    if (
      profile.maxBeachDistanceMetres !== null &&
      hotel.distanceToBeachMetres !== null &&
      hotel.distanceToBeachMetres > profile.maxBeachDistanceMetres
    ) {
      violations.push({
        code: 'BEACH_TOO_FAR',
        message: `The hotel is ${hotel.distanceToBeachMetres} m from the beach, beyond the ${profile.maxBeachDistanceMetres} m limit.`,
        detail: {
          distanceToBeachMetres: hotel.distanceToBeachMetres,
          maxBeachDistanceMetres: profile.maxBeachDistanceMetres,
        },
      });
    }
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
  | 'SELF_TRANSFER_UNKNOWN'
  | 'CABIN_BAGGAGE_ONLY'
  | 'BAGGAGE_ALLOWANCE_UNKNOWN'
  | 'LATE_ARRIVAL'
  | 'EARLY_DEPARTURE'
  | 'LONG_TRANSFER'
  | 'NON_REFUNDABLE'
  | 'EXCLUDED_FEES'
  | 'ESTIMATE_HEAVY_TOTAL'
  | 'NO_TRANSFER_PRICED'
  | 'NO_STAY_PRICED'
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

export function detectTravelWarnings(candidate: TripCandidate, cost: TripCost): TravelWarning[] {
  const warnings: TravelWarning[] = [];
  const { outbound, inbound } = candidate.flight;

  const selfTransfer = bothLegs(
    outbound.selfTransfer === null ? null : !outbound.selfTransfer,
    inbound.selfTransfer === null ? null : !inbound.selfTransfer,
  );

  if (selfTransfer === false) {
    warnings.push({
      code: 'SELF_TRANSFER_RISK',
      severity: 'confirmed',
      message:
        'Connections are booked on separate tickets. A missed connection is not protected by the airline.',
    });
  } else if (selfTransfer === null) {
    // Silence is not safety. The expensive version of this surprise is finding
    // out at the gate, so an unstated answer is surfaced rather than assumed.
    warnings.push({
      code: 'SELF_TRANSFER_UNKNOWN',
      severity: 'needs_verification',
      message:
        'This provider did not say whether the connections are on one ticket. Check before booking.',
    });
  }

  const checkedBaggage = bothLegs(outbound.checkedBaggageIncluded, inbound.checkedBaggageIncluded);

  if (checkedBaggage === false) {
    warnings.push({
      code: 'CABIN_BAGGAGE_ONLY',
      severity: 'confirmed',
      message: 'Checked baggage is not included. Adding a bag will increase the total.',
    });
  } else if (checkedBaggage === null) {
    warnings.push({
      code: 'BAGGAGE_ALLOWANCE_UNKNOWN',
      severity: 'needs_verification',
      message:
        'This provider did not state the baggage allowance, so the total may not cover a bag.',
    });
  }

  const arrivalSegment = outbound.segments.at(-1);
  if (arrivalSegment && localHour(arrivalSegment.arrivesAt) >= LATE_ARRIVAL_HOUR) {
    warnings.push({
      code: 'LATE_ARRIVAL',
      severity: 'confirmed',
      message:
        'Arrival is late at night. Check that the hotel reception and transfer still operate.',
    });
  }

  const departureSegment = inbound.segments[0];
  if (departureSegment && localHour(departureSegment.departsAt) < EARLY_DEPARTURE_HOUR) {
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

  if (!candidate.hotel) {
    warnings.push({
      code: 'NO_STAY_PRICED',
      severity: 'needs_verification',
      message: 'No stay was priced, so the total covers flights only. Add a stay to see the cost.',
    });
  } else if (!candidate.hotel.freeCancellation) {
    warnings.push({
      code: 'NON_REFUNDABLE',
      severity: 'confirmed',
      message: 'The hotel rate is non-refundable.',
    });
  }

  if (candidate.hotel?.excludedFees && candidate.hotel.excludedFees.amount > 0) {
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
