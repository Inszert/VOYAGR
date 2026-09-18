import type { ErrorCode } from '@/lib/errors';
import type { TripCost } from '@/core/trip/cost';
import type { EligibilityResult, TravelWarning } from '@/core/trip/constraints';
import type { TripScore } from '@/core/trip/scoring';
import type { UsableTimeResult } from '@/core/trip/usable-time';
import type { AirportCode, IsoDate, SearchProfile, TripCandidate } from '@/core/trip/types';
import type { ProviderKind } from '@/providers/types';

/**
 * Search orchestration types (implementation plan 1.1).
 *
 * The orchestrator turns a `SearchProfile` into ranked, costed, constrained
 * trips. Nothing here computes a number: every figure on a `RankedTrip` comes
 * from `src/core/`, and this layer only decides which candidates exist and in
 * what order they are shown.
 */

/**
 * Limits on the fan-out.
 *
 * A flexible-date, multi-airport, several-destination search multiplies out
 * fast: 20 departure dates x 6 trip lengths x 8 destinations is 960 hotel
 * calls before a single trip has been assembled. Every one of these is a hard
 * ceiling rather than a hint, and what was dropped is reported in the
 * diagnostics rather than hidden.
 */
export interface SearchLimits {
  /** Departure/return pairs actually searched, sampled across the window. */
  readonly maxDateWindows: number;
  readonly maxOrigins: number;
  readonly maxDestinations: number;
  /** Flight offers kept per destination, per date window, cheapest first. */
  readonly maxFlightOffersPerRoute: number;
  /** Hotel offers kept per destination, per date window, cheapest first. */
  readonly maxHotelOffersPerDestination: number;
  /** Assembled combinations kept per destination, per date window. */
  readonly maxCandidatesPerRoute: number;
  /** Total combinations costed and scored across the whole search. */
  readonly maxCandidates: number;
  readonly maxResults: number;
  readonly maxNearMisses: number;
  /**
   * Provider calls allowed in flight at once, across the entire search.
   *
   * Enforced by a single shared limiter rather than by a number handed to each
   * fan-out, so nesting cannot multiply it.
   */
  readonly providerConcurrency: number;
  readonly providerTimeoutMs: number;
}

/**
 * Defaults chosen so that nothing is silently dropped at the defaults
 * themselves: 8 date windows x 6 destinations x 12 combinations is 576, just
 * inside `maxCandidates`. Raising one of the inner limits is what makes the
 * outer cap bite, and the diagnostics say when it did.
 *
 * The provider-call budget these imply is 8 flight calls, 48 hotel calls and
 * one weather and one transfer call per destination. Generous for mocks;
 * worth revisiting against a real provider's rate limit and price list.
 */
export const DEFAULT_SEARCH_LIMITS: SearchLimits = {
  maxDateWindows: 8,
  maxOrigins: 4,
  maxDestinations: 6,
  maxFlightOffersPerRoute: 3,
  maxHotelOffersPerDestination: 4,
  maxCandidatesPerRoute: 12,
  maxCandidates: 600,
  maxResults: 40,
  maxNearMisses: 10,
  providerConcurrency: 6,
  providerTimeoutMs: 8_000,
};

export interface SearchRequest {
  readonly profile: SearchProfile;
  /** Candidate destination airports. Anywhere mode is a later phase. */
  readonly destinations: readonly AirportCode[];
  /**
   * Display names by airport code. Falls back to the code itself.
   *
   * A placeholder for the `destinations` table (specification section 21):
   * orchestration must not reach into provider fixtures for a place name.
   */
  readonly destinationNames?: Readonly<Record<AirportCode, string>>;
  readonly limits?: Partial<SearchLimits>;
  /** Correlation id threaded into every provider call and log line. */
  readonly requestId?: string;
}

/** One departure/return pair the search will actually price. */
export interface DateWindow {
  readonly departureDate: IsoDate;
  readonly returnDate: IsoDate;
  readonly nights: number;
}

export interface SearchPlan {
  readonly origins: readonly AirportCode[];
  readonly destinations: readonly AirportCode[];
  readonly dateWindows: readonly DateWindow[];
  /** Date windows the profile allows, before the limit was applied. */
  readonly dateWindowsAvailable: number;
  /** Origins and destinations the request named, before the limits applied. */
  readonly originsRequested: number;
  readonly destinationsRequested: number;
  readonly currency: string;
  readonly passengers: number;
  /** Earliest and latest date any provider will be asked about. */
  readonly earliestDate: IsoDate;
  readonly latestDate: IsoDate;
  readonly limits: SearchLimits;
}

/**
 * A provider call that failed.
 *
 * Recorded rather than thrown. One provider failing degrades a search; it never
 * aborts it. `message` is the error's public message, so a diagnostics object is
 * safe to return to a client.
 */
export interface ProviderIssue {
  readonly kind: ProviderKind;
  readonly providerId: string;
  /** What was being fetched, e.g. `flights:2026-06-10..2026-06-15`. */
  readonly scope: string;
  readonly code: ErrorCode;
  readonly message: string;
}

/** A candidate with every derived figure attached. */
export interface RankedTrip {
  readonly candidate: TripCandidate;
  readonly cost: TripCost;
  readonly eligibility: EligibilityResult;
  readonly warnings: readonly TravelWarning[];
  readonly score: TripScore;
  readonly usableTime: UsableTimeResult;
}

export interface SearchDiagnostics {
  readonly plan: SearchPlan;
  readonly providerCalls: number;
  /**
   * Highest number of provider calls that were in flight at once.
   *
   * Reported so the concurrency bound is observable rather than merely
   * intended: it must never exceed `plan.limits.providerConcurrency`.
   */
  readonly peakProviderConcurrency: number;
  readonly issues: readonly ProviderIssue[];
  /** True when any provider call failed, so the result set is incomplete. */
  readonly degraded: boolean;
  /** Combinations built from provider offers, before the total cap. */
  readonly candidatesAssembled: number;
  /** Combinations actually costed and scored. */
  readonly candidatesEvaluated: number;
  readonly eligibleCount: number;
  readonly ineligibleCount: number;
  readonly durationMs: number;
}

export interface SearchOutcome {
  /** Eligible trips, best first. */
  readonly results: readonly RankedTrip[];
  /**
   * Trips that broke a hard rule, best first, with every violation attached.
   * Surfaced rather than discarded so a search that finds nothing can explain
   * what came close and why it did not qualify.
   */
  readonly nearMisses: readonly RankedTrip[];
  readonly diagnostics: SearchDiagnostics;
}
