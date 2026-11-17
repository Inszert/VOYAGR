import { describe, expect, it } from 'vitest';
import { money } from '../money';
import { costTripCandidate } from './cost';
import {
  BASE_WEIGHTS,
  DEFAULT_PART_WEIGHTS,
  weightedRankScore,
  type ScoreFactorKey,
  itineraryCompleteness,
  resolveWeights,
  scoreBudgetFit,
  scoreFlightQuality,
  scoreTrip,
} from './scoring';
import {
  buildCandidate,
  buildFlightOffer,
  buildHotelOffer,
  buildLeg,
  buildProfile,
  buildWeather,
} from './test-support';

function score(candidate = buildCandidate(), profile = buildProfile()) {
  return scoreTrip(candidate, costTripCandidate(candidate), profile);
}

describe('weights', () => {
  it('always normalises to 1', () => {
    // Scores must stay comparable across travel styles and optimisation modes.
    for (const style of ['balanced', 'beach', 'luxury', 'explore'] as const) {
      for (const mode of ['best_value', 'cheapest', 'maximise_hotel_quality'] as const) {
        const weights = resolveWeights(style, mode);
        const total = Object.values(weights).reduce((sum, weight) => sum + weight, 0);

        expect(total).toBeCloseTo(1, 10);
      }
    }
  });

  it('shifts weight toward weather for a beach trip', () => {
    const balanced = resolveWeights('balanced', 'best_value');
    const beach = resolveWeights('beach', 'best_value');

    expect(beach.weather).toBeGreaterThan(balanced.weather);
  });

  it('shifts weight toward price when asked for the cheapest trip', () => {
    const balanced = resolveWeights('balanced', 'best_value');
    const cheapest = resolveWeights('balanced', 'cheapest');

    expect(cheapest.budget_fit).toBeGreaterThan(balanced.budget_fit);
  });
});

describe('scoreBudgetFit', () => {
  const profile = buildProfile();

  it('scores a trip at the target budget perfectly', () => {
    expect(scoreBudgetFit(money(65000, 'EUR'), profile)).toBe(1);
  });

  it('scores a trip just under the target perfectly', () => {
    expect(scoreBudgetFit(money(52000, 'EUR'), profile)).toBe(1);
  });

  it('penalises a suspiciously cheap trip', () => {
    // A trip at a fifth of budget is usually a compromised one, not a bargain.
    expect(scoreBudgetFit(money(13000, 'EUR'), profile)).toBeLessThan(0.2);
  });

  it('decays between the target and the maximum', () => {
    const atTarget = scoreBudgetFit(money(65000, 'EUR'), profile);
    const midway = scoreBudgetFit(money(75000, 'EUR'), profile);
    const atMax = scoreBudgetFit(money(85000, 'EUR'), profile);

    expect(atTarget).toBeGreaterThan(midway);
    expect(midway).toBeGreaterThan(atMax);
    expect(atMax).toBeCloseTo(0, 5);
  });

  it('is monotonic across the whole range', () => {
    let previous = -1;
    let peaked = false;

    for (let amount = 10000; amount <= 90000; amount += 1000) {
      const value = scoreBudgetFit(money(amount, 'EUR'), profile);

      if (!peaked && value < previous) peaked = true;
      // Once past the peak it must never rise again.
      if (peaked) expect(value).toBeLessThanOrEqual(previous + 1e-9);

      previous = value;
    }

    expect(peaked).toBe(true);
  });
});

describe('scoreTrip', () => {
  it('produces a score between 0 and 100', () => {
    const result = score();

    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(Number.isInteger(result.score)).toBe(true);
  });

  it('is fully explainable: the score equals the sum of its contributions', () => {
    // If this ever drifts, the UI would show a score it cannot justify, which
    // is exactly what specification section 31.3 forbids.
    const result = score();
    const summed = result.factors.reduce((total, factor) => total + factor.contribution, 0);

    expect(Math.round(summed * 100)).toBe(result.score);
  });

  it('is deterministic', () => {
    expect(score().score).toBe(score().score);
  });

  it('reports every factor with a weight and a contribution', () => {
    for (const factor of score().factors) {
      expect(factor.value).toBeGreaterThanOrEqual(0);
      expect(factor.value).toBeLessThanOrEqual(1);
      expect(factor.contribution).toBeCloseTo(factor.value * factor.weight, 10);
      expect(factor.label).toBeTruthy();
    }
  });

  it('ranks a better hotel above a worse one, all else equal', () => {
    const good = score(
      buildCandidate({ hotel: buildHotelOffer({ reviewScore: 9.4, starRating: 5 }) }),
    );
    const poor = score(
      buildCandidate({ hotel: buildHotelOffer({ reviewScore: 6.5, starRating: 2 }) }),
    );

    expect(good.score).toBeGreaterThan(poor.score);
  });

  it('penalises a self-transfer connection', () => {
    const risky = score(
      buildCandidate({
        flight: buildFlightOffer({
          outbound: buildLeg({
            selfTransfer: true,
            segments: [
              {
                origin: 'VIE',
                destination: 'IST',
                departsAt: '2026-06-10T09:30:00',
                arrivesAt: '2026-06-10T11:00:00',
                carrier: 'TK',
                flightNumber: 'TK1',
              },
              {
                origin: 'IST',
                destination: 'AYT',
                departsAt: '2026-06-10T12:30:00',
                arrivesAt: '2026-06-10T13:45:00',
                carrier: 'TK',
                flightNumber: 'TK2',
              },
            ],
          }),
        }),
      }),
    );

    expect(risky.score).toBeLessThan(score().score);
  });

  it('pulls a low-confidence forecast toward neutral rather than asserting sun', () => {
    // Section 13: a long-range outlook must not be scored as though it were a
    // forecast, in either direction.
    const perfectButUnknown = buildWeather(5).map((day) => ({ ...day, confidence: 0.1 }));
    const perfectAndKnown = buildWeather(5).map((day) => ({ ...day, confidence: 0.95 }));

    const unknown = score(buildCandidate({ weather: perfectButUnknown }));
    const known = score(buildCandidate({ weather: perfectAndKnown }));

    const unknownWeather = unknown.factors.find((f) => f.key === 'weather')!;
    const knownWeather = known.factors.find((f) => f.key === 'weather')!;

    expect(knownWeather.value).toBeGreaterThan(unknownWeather.value);
    expect(unknownWeather.value).toBeCloseTo(0.5, 1);
  });

  it('reports evidence strength separately from the score', () => {
    const result = score();

    expect(result.evidenceStrength).toBeGreaterThan(0);
    expect(result.evidenceStrength).toBeLessThanOrEqual(1);
  });

  it('names strengths and weaknesses', () => {
    const result = score();

    expect(result.strengths.length).toBeGreaterThan(0);
    expect(result.weaknesses.length).toBeGreaterThan(0);
    // The strongest contributor should not also be reported as the top weakness.
    expect(result.strengths[0]!.key).not.toBe(result.weaknesses[0]!.key);
  });

  it('responds to the optimisation mode', () => {
    const expensive = buildCandidate({
      hotel: buildHotelOffer({ totalPrice: money(46000, 'EUR') }),
    });

    const asCheapest = score(expensive, buildProfile({ optimisationMode: 'cheapest' }));
    const asNicest = score(expensive, buildProfile({ optimisationMode: 'maximise_hotel_quality' }));

    expect(asCheapest.score).not.toBe(asNicest.score);
  });
});

describe('scoring a partly described itinerary', () => {
  const withFlags = (flags: {
    cabinBaggageIncluded: boolean | null;
    checkedBaggageIncluded: boolean | null;
    selfTransfer: boolean | null;
  }) =>
    buildCandidate({
      flight: buildFlightOffer({
        outbound: buildLeg(flags),
        inbound: buildLeg(flags),
      }),
    });

  const known = withFlags({
    cabinBaggageIncluded: true,
    checkedBaggageIncluded: true,
    selfTransfer: false,
  });
  const unknown = withFlags({
    cabinBaggageIncluded: null,
    checkedBaggageIncluded: null,
    selfTransfer: null,
  });
  const bad = withFlags({
    cabinBaggageIncluded: false,
    checkedBaggageIncluded: false,
    selfTransfer: true,
  });

  it('places an unstated itinerary between a good one and a bad one', () => {
    // Full penalty would punish a terse provider; none would rank an unproven
    // trip alongside a proven one.
    const quality = (candidate: typeof known) => scoreFlightQuality(candidate);

    expect(quality(known)).toBeGreaterThan(quality(unknown));
    expect(quality(unknown)).toBeGreaterThan(quality(bad));
  });

  it('lowers data confidence when the provider left facts unstated', () => {
    const profile = buildProfile();
    const knownScore = scoreTrip(known, costTripCandidate(known), profile);
    const unknownScore = scoreTrip(unknown, costTripCandidate(unknown), profile);

    expect(unknownScore.evidenceStrength).toBeLessThan(knownScore.evidenceStrength);
  });

  it('reports completeness as the share of facts actually stated', () => {
    expect(itineraryCompleteness(known)).toBe(1);
    expect(itineraryCompleteness(unknown)).toBe(0);

    const half = buildCandidate({
      flight: buildFlightOffer({
        outbound: buildLeg({
          cabinBaggageIncluded: true,
          checkedBaggageIncluded: true,
          selfTransfer: true,
        }),
        inbound: buildLeg({
          cabinBaggageIncluded: null,
          checkedBaggageIncluded: null,
          selfTransfer: null,
        }),
      }),
    });
    expect(itineraryCompleteness(half)).toBe(0.5);
  });

  it('keeps the score equal to the sum of its reported contributions', () => {
    // The explainability guarantee has to survive a partly described itinerary.
    const score = scoreTrip(unknown, costTripCandidate(unknown), buildProfile());
    const summed = score.factors.reduce((total, factor) => total + factor.contribution, 0);

    expect(score.score).toBe(Math.round(summed * 100));
  });
});

describe('scoring a trip with no priced stay', () => {
  const priced = buildCandidate();
  const unpriced = buildCandidate({ hotel: null });

  it('scores the stay-dependent factors neutrally, as for an unrated hotel', () => {
    const { factors } = score(unpriced);

    expect(factors.find((factor) => factor.key === 'hotel_quality')?.value).toBe(0.5);
    expect(factors.find((factor) => factor.key === 'location')?.value).toBe(0.5);
  });

  it('lowers data confidence, because a stay nobody priced is a fact we lack', () => {
    expect(score(unpriced).evidenceStrength).toBeLessThan(score(priced).evidenceStrength);
    expect(itineraryCompleteness(unpriced)).toBeLessThan(itineraryCompleteness(priced));
  });
});

describe('weightedRankScore', () => {
  const factor = (key: ScoreFactorKey, value: number, weight: number) => ({
    key,
    label: key,
    value,
    weight,
    contribution: value * weight,
  });

  const tripScore = (values: Partial<Record<ScoreFactorKey, number>>, rounded: number) => {
    const factors = (Object.keys(BASE_WEIGHTS) as ScoreFactorKey[]).map((key) =>
      factor(key, values[key] ?? 0.5, BASE_WEIGHTS[key]),
    );
    return { score: rounded, factors, strengths: [], weaknesses: [], evidenceStrength: 0.5 };
  };

  // A has the better cost fit and weather, B has the better stay. Equal overall.
  const a = tripScore({ budget_fit: 0.9, weather: 0.9, hotel_quality: 0.3, location: 0.3 }, 50);
  const b = tripScore({ budget_fit: 0.3, weather: 0.3, hotel_quality: 0.6, location: 0.6 }, 50);

  it('is exactly the engine score with no weights or all weights at 1', () => {
    expect(weightedRankScore(a)).toBe(50);
    expect(weightedRankScore(a, DEFAULT_PART_WEIGHTS)).toBe(50);
    expect(weightedRankScore(b, { ...DEFAULT_PART_WEIGHTS })).toBe(50);
  });

  it('raising cost moves the better-fitting trip ahead; flights have no slider', () => {
    const w = { ...DEFAULT_PART_WEIGHTS, cost: 2 };
    expect(weightedRankScore(a, w)).toBeGreaterThan(weightedRankScore(b, w));
    expect(Object.keys(DEFAULT_PART_WEIGHTS)).not.toContain('flights');
  });

  it('raising weather moves the sunnier trip ahead', () => {
    const w = { ...DEFAULT_PART_WEIGHTS, weather: 2 };
    expect(weightedRankScore(a, w)).toBeGreaterThan(weightedRankScore(b, w));
  });

  it('raising stay moves the stay-strong trip ahead', () => {
    const w = { ...DEFAULT_PART_WEIGHTS, stay: 2, cost: 0.5, weather: 0.5 };
    expect(weightedRankScore(b, w)).toBeGreaterThan(weightedRankScore(a, w));
  });

  it('ignoring a part removes its influence and stays on the 0-100 scale', () => {
    const none = { ...DEFAULT_PART_WEIGHTS, cost: 0, weather: 0 };
    const value = weightedRankScore(a, none);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(100);
    expect(weightedRankScore(a, none)).toBeLessThan(weightedRankScore(b, none));
  });

  it('does not change the score the trip reports', () => {
    const before = JSON.stringify(a);
    weightedRankScore(a, { ...DEFAULT_PART_WEIGHTS, cost: 2 });
    expect(JSON.stringify(a)).toBe(before);
  });

  it('the Cost slider re-ranks only: scoring a trip leaves its total and score unchanged', () => {
    const cost = { total: { amount: 123456, currency: 'EUR' } };
    const reported = { ...a, cost };
    const before = JSON.stringify(reported);
    weightedRankScore(reported, { ...DEFAULT_PART_WEIGHTS, cost: 0 });
    weightedRankScore(reported, { ...DEFAULT_PART_WEIGHTS, cost: 2 });
    expect(JSON.stringify(reported)).toBe(before);
    expect(reported.cost.total.amount).toBe(123456);
    expect(reported.score).toBe(50);
  });
});

describe('weightedRankScore with nature and food', () => {
  const factors = (Object.keys(BASE_WEIGHTS) as ScoreFactorKey[]).map((key) => ({
    key,
    label: key,
    value: 0.6,
    weight: BASE_WEIGHTS[key],
    contribution: 0.6 * BASE_WEIGHTS[key],
  }));
  const trip = (interests?: { nature: number | null; food: number | null }) => ({
    score: 60,
    factors,
    strengths: [],
    weaknesses: [],
    evidenceStrength: 0.5,
    ...(interests ? { interests } : {}),
  });
  const natureUp = { ...DEFAULT_PART_WEIGHTS, nature: 2 };
  const foodUp = { ...DEFAULT_PART_WEIGHTS, food: 2 };

  it('the new sliders default to normal and leave the engine score as it was', () => {
    expect(DEFAULT_PART_WEIGHTS.nature).toBe(1);
    expect(DEFAULT_PART_WEIGHTS.food).toBe(1);
    expect(weightedRankScore(trip({ nature: 1, food: 1 }), DEFAULT_PART_WEIGHTS)).toBe(60);
    // Lowering a slider below normal has nothing to take away.
    expect(
      weightedRankScore(trip({ nature: 0.1, food: 0.1 }), { ...DEFAULT_PART_WEIGHTS, nature: 0 }),
    ).toBeCloseTo(60);
  });

  it('raising Nature puts the nature-rich trip ahead of an equal one', () => {
    expect(weightedRankScore(trip({ nature: 0.9, food: 0.1 }), natureUp)).toBeGreaterThan(
      weightedRankScore(trip({ nature: 0.1, food: 0.9 }), natureUp),
    );
  });

  it('raising Food puts the food-rich trip ahead of an equal one', () => {
    expect(weightedRankScore(trip({ nature: 0.1, food: 0.9 }), foodUp)).toBeGreaterThan(
      weightedRankScore(trip({ nature: 0.9, food: 0.1 }), foodUp),
    );
  });

  it('a null share is left out: the trip ranks as if the slider were not there, not as a zero', () => {
    const left = weightedRankScore(trip({ nature: null, food: null }), natureUp);
    const bare = weightedRankScore(trip(), natureUp);
    const zero = weightedRankScore(trip({ nature: 0, food: null }), natureUp);

    expect(left).toBeCloseTo(bare);
    expect(left).toBeCloseTo(60);
    expect(zero).toBeLessThan(left);
  });

  it('a food share does not move a Nature-only ranking', () => {
    expect(weightedRankScore(trip({ nature: null, food: 1 }), natureUp)).toBeCloseTo(60);
  });

  it('does not change what the trip reports', () => {
    const reported = trip({ nature: 0.9, food: 0.2 });
    const before = JSON.stringify(reported);
    weightedRankScore(reported, natureUp);
    expect(JSON.stringify(reported)).toBe(before);
  });
});
