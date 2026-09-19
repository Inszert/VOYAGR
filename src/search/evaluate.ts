import { costTripCandidate } from '@/core/trip/cost';
import { detectTravelWarnings, evaluateEligibility } from '@/core/trip/constraints';
import { scoreTrip } from '@/core/trip/scoring';
import { computeUsableTime } from '@/core/trip/usable-time';
import type { SearchProfile, TripCandidate } from '@/core/trip/types';
import type { RankedTrip } from './types';

/**
 * Cost, check and score one candidate.
 *
 * The single path from "here is a trip" to "here is everything we can say about
 * it". The orchestrator uses it for every candidate it assembles, and component
 * swapping uses it for the trip a user just built by hand - which is the whole
 * reason it is its own function. A swapped trip evaluated by a second,
 * similar-looking routine would be a second place for a total to come from.
 *
 * Pure: no I/O, no clock. Given the same candidate and profile it always
 * produces the same figures, which is what lets a swap be compared against the
 * original without re-running a search.
 */
export function evaluateTrip(candidate: TripCandidate, profile: SearchProfile): RankedTrip {
  const cost = costTripCandidate(candidate);

  return {
    candidate,
    cost,
    eligibility: evaluateEligibility(candidate, cost, profile),
    warnings: detectTravelWarnings(candidate, cost),
    score: scoreTrip(candidate, cost, profile),
    usableTime: computeUsableTime(candidate),
  };
}
