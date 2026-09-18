import { ratio, type Money } from '../money';
import type { TripCost } from './cost';
import { computeUsableTime, usableTimeEfficiency } from './usable-time';
import type { OptimisationMode, SearchProfile, TravelStyle, TripCandidate } from './types';

/**
 * Complete Trip Value Score (specification section 31.3).
 *
 * Deterministic and explainable by construction. Every factor is normalised to
 * 0-1, multiplied by a weight, and reported individually, so the UI can answer
 * "why is this 84 and not 91?" without asking a model to guess.
 *
 * The model may *describe* a score. It may never *produce* one.
 */

export type ScoreFactorKey =
  | 'budget_fit'
  | 'flight_quality'
  | 'hotel_quality'
  | 'location'
  | 'weather'
  | 'usable_time'
  | 'transfer'
  | 'data_confidence';

export interface ScoreFactor {
  readonly key: ScoreFactorKey;
  readonly label: string;
  /** Normalised factor value, 0-1. */
  readonly value: number;
  /** Weight applied for the active travel style and optimisation mode. */
  readonly weight: number;
  /** value * weight, the factor's contribution to the raw score. */
  readonly contribution: number;
}

export interface TripScore {
  /** Final score, 0-100, rounded to the nearest integer. */
  readonly score: number;
  readonly factors: readonly ScoreFactor[];
  /** Factors ordered by contribution, strongest first. */
  readonly strengths: readonly ScoreFactor[];
  /** Factors with the most room to improve, weakest first. */
  readonly weaknesses: readonly ScoreFactor[];
  /**
   * How much of the score rests on quoted rather than estimated data, 0-1.
   * Reported separately so a confident-looking score cannot hide thin evidence.
   */
  readonly evidenceStrength: number;
}

export type ScoreWeights = Record<ScoreFactorKey, number>;

/** Baseline weights, used when no travel style adjustment applies. */
export const BASE_WEIGHTS: ScoreWeights = {
  budget_fit: 0.24,
  flight_quality: 0.14,
  hotel_quality: 0.16,
  location: 0.12,
  weather: 0.14,
  usable_time: 0.12,
  transfer: 0.04,
  data_confidence: 0.04,
};

/** Per-style multipliers applied to the baseline, then renormalised to sum to 1. */
const STYLE_MULTIPLIERS: Partial<Record<TravelStyle, Partial<ScoreWeights>>> = {
  full_chill: { weather: 1.4, hotel_quality: 1.3, flight_quality: 0.8, usable_time: 0.8 },
  chill: { weather: 1.25, hotel_quality: 1.2, usable_time: 0.9 },
  balanced: {},
  explore: { location: 1.4, usable_time: 1.3, hotel_quality: 0.8 },
  culture: { location: 1.5, usable_time: 1.2, weather: 0.8 },
  food: { location: 1.3, hotel_quality: 0.9 },
  beach: { weather: 1.5, location: 1.3, hotel_quality: 1.1 },
  nightlife: { location: 1.4, usable_time: 1.2, weather: 0.8 },
  adventure: { usable_time: 1.3, weather: 1.1, hotel_quality: 0.7 },
  luxury: { hotel_quality: 1.6, budget_fit: 0.6, transfer: 1.5 },
};

const MODE_MULTIPLIERS: Partial<Record<OptimisationMode, Partial<ScoreWeights>>> = {
  cheapest: { budget_fit: 2.2, hotel_quality: 0.5, flight_quality: 0.7 },
  best_value: {},
  nicest_within_budget: { hotel_quality: 1.5, budget_fit: 0.5, location: 1.2 },
  maximise_beach_time: { weather: 1.5, usable_time: 1.4, location: 1.3 },
  maximise_hotel_quality: { hotel_quality: 2.0, budget_fit: 0.6 },
  maximise_food_quality: { location: 1.4, budget_fit: 0.8 },
  maximise_exploration: { location: 1.5, usable_time: 1.4 },
};

/**
 * Combine baseline weights with style and mode multipliers.
 * The result always sums to 1, so scores stay comparable across profiles.
 */
export function resolveWeights(style: TravelStyle, mode: OptimisationMode): ScoreWeights {
  const styleMultipliers = STYLE_MULTIPLIERS[style] ?? {};
  const modeMultipliers = MODE_MULTIPLIERS[mode] ?? {};

  const raw = {} as ScoreWeights;
  let total = 0;

  for (const key of Object.keys(BASE_WEIGHTS) as ScoreFactorKey[]) {
    const weight = BASE_WEIGHTS[key] * (styleMultipliers[key] ?? 1) * (modeMultipliers[key] ?? 1);
    raw[key] = weight;
    total += weight;
  }

  if (total === 0) return { ...BASE_WEIGHTS };

  for (const key of Object.keys(raw) as ScoreFactorKey[]) {
    raw[key] = raw[key] / total;
  }

  return raw;
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** Map a value in [min, max] onto [0, 1], clamped outside the range. */
function normalise(value: number, min: number, max: number): number {
  if (max === min) return 0.5;
  return clamp01((value - min) / (max - min));
}

/**
 * Budget fit.
 *
 * Peaks slightly under the target budget rather than at zero spend: a trip that
 * comes in at a third of the budget is usually a worse holiday, not a better
 * one. Spending above the target decays toward the hard maximum.
 */
/** Spend below this share of target reads as a compromised trip, not a bargain. */
const BUDGET_UNDERSPEND_FLOOR = 0.2;
/** From this share of target up to the target itself, budget fit is ideal. */
const BUDGET_SWEET_SPOT = 0.75;

export function scoreBudgetFit(total: Money, profile: SearchProfile): number {
  const used = ratio(total, profile.targetBudget);

  // Ramp up: spending almost nothing usually means an unusable trip.
  if (used < BUDGET_SWEET_SPOT) {
    return normalise(used, BUDGET_UNDERSPEND_FLOOR, BUDGET_SWEET_SPOT);
  }

  // Plateau: anywhere from the sweet spot to the target is a perfect fit.
  if (used <= 1) return 1;

  // Decay: between the target and the hard maximum, fit falls from 1 to 0.
  const overshootRange = ratio(profile.maxBudget, profile.targetBudget) - 1;
  if (overshootRange <= 0) return 0;

  return clamp01(1 - (used - 1) / overshootRange);
}

export function scoreFlightQuality(candidate: TripCandidate): number {
  const { outbound, inbound } = candidate.flight;
  const legs = [outbound, inbound];

  let total = 0;

  for (const leg of legs) {
    let leg_score = 1;

    // Connections cost convenience and add risk.
    const connections = Math.max(0, leg.segments.length - 1);
    leg_score -= connections * 0.2;

    if (leg.selfTransfer) leg_score -= 0.25;
    if (!leg.cabinBaggageIncluded) leg_score -= 0.15;
    if (!leg.checkedBaggageIncluded) leg_score -= 0.1;

    // Duration: 2h or less is ideal, 12h or more is poor.
    leg_score -= (1 - normalise(leg.durationMinutes, 720, 120)) * 0.25;

    total += clamp01(leg_score);
  }

  return total / legs.length;
}

export function scoreHotelQuality(candidate: TripCandidate): number {
  const { hotel } = candidate;

  // Review score carries most of the weight; stars are a weaker signal.
  const reviewComponent = hotel.reviewScore === null ? 0.5 : normalise(hotel.reviewScore, 5, 9.5);
  const starComponent = hotel.starRating === null ? 0.5 : normalise(hotel.starRating, 2, 5);

  // A high score from twelve reviews is not the same as one from twelve hundred.
  const reviewConfidence = normalise(Math.log10(Math.max(1, hotel.reviewCount)), 0, 3);

  const boardBonus =
    hotel.boardType === 'all_inclusive' || hotel.boardType === 'full_board'
      ? 0.08
      : hotel.boardType === 'half_board'
        ? 0.05
        : hotel.boardType === 'breakfast'
          ? 0.03
          : 0;

  const cancellationBonus = hotel.freeCancellation ? 0.05 : 0;

  const base = reviewComponent * (0.6 + 0.2 * reviewConfidence) + starComponent * 0.2;

  return clamp01(base + boardBonus + cancellationBonus);
}

export function scoreLocation(candidate: TripCandidate): number {
  const { distanceToBeachMetres, distanceToCentreMetres } = candidate.hotel;

  // 150 m is excellent, 3 km is poor. Unknown distances score neutrally rather
  // than optimistically.
  const beach =
    distanceToBeachMetres === null ? 0.5 : 1 - normalise(distanceToBeachMetres, 150, 3000);
  const centre =
    distanceToCentreMetres === null ? 0.5 : 1 - normalise(distanceToCentreMetres, 150, 3000);

  return clamp01(beach * 0.6 + centre * 0.4);
}

/**
 * Weather score.
 *
 * Each forecast day is scored on temperature, rain and wind, then weighted by
 * the forecast's own confidence. A low-confidence outlook pulls the result
 * toward neutral instead of asserting sunshine we cannot promise.
 */
export function scoreWeather(candidate: TripCandidate): number {
  if (candidate.weather.length === 0) return 0.5;

  let total = 0;

  for (const day of candidate.weather) {
    const mid = (day.temperatureMinC + day.temperatureMaxC) / 2;
    // Comfort peaks around 26 C and falls away on both sides.
    const temperature = clamp01(1 - Math.abs(mid - 26) / 14);
    const dryness = clamp01(1 - day.precipitationProbability);
    const calm = 1 - normalise(day.windKph, 10, 45);

    const dayScore = clamp01(temperature * 0.5 + dryness * 0.35 + calm * 0.15);
    const confidence = clamp01(day.confidence);

    // Pull toward neutral in proportion to how little the forecast is trusted.
    total += dayScore * confidence + 0.5 * (1 - confidence);
  }

  return clamp01(total / candidate.weather.length);
}

export function scoreTransfer(candidate: TripCandidate): number {
  if (!candidate.transfer) return 0.35;

  // 15 minutes is excellent, 120 minutes is poor.
  const duration = 1 - normalise(candidate.transfer.durationMinutes, 15, 120);
  const modeBonus =
    candidate.transfer.mode === 'private' || candidate.transfer.mode === 'walk'
      ? 0.1
      : candidate.transfer.mode === 'taxi'
        ? 0.05
        : 0;

  return clamp01(duration + modeBonus);
}

/** How much of the total is quoted rather than estimated. */
export function scoreDataConfidence(cost: TripCost, candidate: TripCandidate): number {
  const weatherConfidence =
    candidate.weather.length === 0
      ? 0.5
      : candidate.weather.reduce((total, day) => total + clamp01(day.confidence), 0) /
        candidate.weather.length;

  return clamp01(cost.knownShare * 0.7 + weatherConfidence * 0.3);
}

const FACTOR_LABELS: Record<ScoreFactorKey, string> = {
  budget_fit: 'Budget fit',
  flight_quality: 'Flight quality',
  hotel_quality: 'Hotel quality',
  location: 'Location',
  weather: 'Weather',
  usable_time: 'Usable holiday time',
  transfer: 'Airport transfer',
  data_confidence: 'Data confidence',
};

/**
 * Score a costed candidate against a search profile.
 *
 * @returns an explainable score. `factors` is the complete derivation; the score
 *   is exactly the sum of the contributions, scaled to 0-100.
 */
export function scoreTrip(
  candidate: TripCandidate,
  cost: TripCost,
  profile: SearchProfile,
): TripScore {
  const weights = resolveWeights(profile.travelStyle, profile.optimisationMode);

  const values: Record<ScoreFactorKey, number> = {
    budget_fit: clamp01(scoreBudgetFit(cost.total, profile)),
    flight_quality: scoreFlightQuality(candidate),
    hotel_quality: scoreHotelQuality(candidate),
    location: scoreLocation(candidate),
    weather: scoreWeather(candidate),
    usable_time: usableTimeEfficiency(computeUsableTime(candidate)),
    transfer: scoreTransfer(candidate),
    data_confidence: scoreDataConfidence(cost, candidate),
  };

  const factors: ScoreFactor[] = (Object.keys(values) as ScoreFactorKey[]).map((key) => ({
    key,
    label: FACTOR_LABELS[key],
    value: values[key],
    weight: weights[key],
    contribution: values[key] * weights[key],
  }));

  const raw = factors.reduce((total, factor) => total + factor.contribution, 0);

  const byContribution = [...factors].sort((a, b) => b.contribution - a.contribution);
  // "Room to improve" is weight-aware: a weak factor nobody weights is not a
  // weakness worth reporting.
  const byShortfall = [...factors].sort(
    (a, b) => (1 - a.value) * a.weight - (1 - b.value) * b.weight,
  );

  return {
    score: Math.round(clamp01(raw) * 100),
    factors,
    strengths: byContribution.slice(0, 3),
    weaknesses: byShortfall.reverse().slice(0, 3),
    evidenceStrength: values.data_confidence,
  };
}
