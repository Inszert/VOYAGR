import { describe, expect, it } from 'vitest';
import { money } from '../money';
import { costTripCandidate } from './cost';
import { resolveWeights, scoreBudgetFit, scoreTrip } from './scoring';
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
                departsAt: '2026-06-10T09:30:00Z',
                arrivesAt: '2026-06-10T11:00:00Z',
                carrier: 'TK',
                flightNumber: 'TK1',
              },
              {
                origin: 'IST',
                destination: 'AYT',
                departsAt: '2026-06-10T12:30:00Z',
                arrivesAt: '2026-06-10T13:45:00Z',
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
