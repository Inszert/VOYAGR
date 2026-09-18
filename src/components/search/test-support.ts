import { costTripCandidate } from '@/core/trip/cost';
import { detectTravelWarnings, evaluateEligibility } from '@/core/trip/constraints';
import { scoreTrip } from '@/core/trip/scoring';
import { computeUsableTime } from '@/core/trip/usable-time';
import { buildCandidate, buildProfile } from '@/core/trip/test-support';
import type { SearchProfile, TripCandidate } from '@/core/trip/types';
import type { RankedTrip } from '@/search/types';

/**
 * A ranked trip for component tests.
 *
 * Built by running the real engines over a candidate rather than by
 * hand-writing a `RankedTrip`. A hand-written one drifts: a component would
 * keep passing its tests against a cost breakdown shape the cost engine no
 * longer produces.
 *
 * Test-only. Not imported by application code.
 */
export function buildRankedTrip(
  overrides: Partial<TripCandidate> = {},
  profileOverrides: Partial<SearchProfile> = {},
): RankedTrip {
  const candidate = buildCandidate(overrides);
  const profile = buildProfile(profileOverrides);
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
