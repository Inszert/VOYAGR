import type { ErrorCode } from '@/lib/errors';
import type { TripCost } from '@/core/trip/cost';
import type { EligibilityResult, TravelWarning } from '@/core/trip/constraints';
import type { TripScore } from '@/core/trip/scoring';
import type { UsableTimeResult } from '@/core/trip/usable-time';
import type {
  AirportCode,
  FlightOffer,
  HotelOffer,
  IsoDate,
  SearchProfile,
  TripCandidate,
} from '@/core/trip/types';
import type { ProviderKind } from '@/providers/types';
import type { DataProvenance } from '@/core/trip/provenance';
import type { DestinationSummary } from './destinations';

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
  /**
   * Pages to request from one provider for one query before giving up.
   *
   * A cursor that never becomes null would otherwise page forever. Two covers
   * a vendor whose first page is smaller than we asked for, without turning a
   * search into a crawl.
   */
  /** Distinct flights and hotels offered as swap options, per route. */
  readonly maxSwapOptionsPerRoute: number;
  readonly maxPagesPerSearch: number;
  readonly providerConcurrency: number;
  /**
   * The most provider calls one search may make, across every provider.
   *
   * The other limits bound the shape of the fan-out; this bounds its cost.
   * Against a mock a call is free and this never bites - the defaults imply
   * about seventy - but against a metered vendor an unbounded fan-out is a
   * bill, and a search that quietly spends four times its usual budget
   * because a request asked for more windows is exactly the surprise the
   * live-provider readiness gate asks to be closed first.
   *
   * Reaching it degrades the search and says so, the same as a failed call.
   */
  readonly maxProviderCalls: number;
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
  maxSwapOptionsPerRoute: 8,
  maxPagesPerSearch: 2,
  providerConcurrency: 6,
  maxProviderCalls: 120,
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
  /**
   * Where these prices came from (1.10.1 section 4).
   *
   * Derived from the adapters that answered, not guessed. The weakest claim
   * wins: one mock component makes the whole result set demo data, because a
   * trip cannot be half-bookable.
   */
  readonly provenance: DataProvenance;
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
  /**
   * How old the quotes behind these results are.
   *
   * Every offer has carried `observedAt` since 1.1 and nothing read it, which
   * the live-provider readiness gate lists as a mock-invisible assumption: a
   * quote is a perishable fact, and a four-hour-old fare shown as "the price"
   * is the sort of silent surprise §31.5 exists to prevent.
   *
   * Counted per ranked trip, taking the weaker of its flight and hotel, so a
   * trip is only as current as its stalest half. **Reported, not acted on.**
   * What to actually do about a stale quote - refuse it, label it, re-check
   * it - depends on a vendor's own validity window, which is exactly what
   * 1.11 goes and finds out. This makes the question answerable first.
   */
  readonly quoteFreshness: {
    readonly fresh: number;
    readonly stale: number;
    /** Quotes with no usable `observedAt`. Its own case, never folded into stale. */
    readonly unknown: number;
  };
  readonly durationMs: number;
}

/**
 * The distinct components a search saw for one route.
 *
 * Collected from every candidate that was evaluated, not from the handful that
 * survived ranking. Component swapping reads this: deriving "what else could I
 * fly?" from a truncated results list means the options on offer depend on how
 * many results the page happens to show, which is nonsense the user would feel
 * as options appearing and vanishing for no reason.
 */
export interface RouteOffers {
  readonly destination: AirportCode;
  readonly departureDate: IsoDate;
  readonly nights: number;
  readonly flights: readonly FlightOffer[];
  readonly hotels: readonly HotelOffer[];
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
  /** Components seen per route, for swapping. */
  readonly routeOffers: readonly RouteOffers[];
  /**
   * What was found at each destination, across every eligible trip.
   *
   * Separate from `results` because `results` is a page and this is an
   * answer: the discovery map asks "where can I go?", and deriving that from
   * the top forty would drop the cheap places that lost on score - which are
   * the ones somebody browsing a map came for.
   */
  readonly destinationSummaries: readonly DestinationSummary[];
  readonly diagnostics: SearchDiagnostics;
}
