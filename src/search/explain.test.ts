import { describe, expect, it } from 'vitest';
import { money } from '@/core/money';
import { buildProfile } from '@/core/trip/test-support';
import { buildRankedTrip } from '@/components/search/test-support';
import { explainTrip, summariseReasons } from './explain';

/**
 * "Why this trip?"
 *
 * Section 9 forbids exposing meaningless technical scoring. These tests check
 * the opposite of the usual thing: not that the words are right, but that
 * every figure in them came from the engines and none of them flatters.
 */

const profile = buildProfile();

describe('explainTrip', () => {
  it('leads with the budget, because that is what people are deciding on', () => {
    const reasons = explainTrip(buildRankedTrip(), profile);

    expect(reasons[0]?.source).toBe('budget');
    expect(reasons.length).toBeGreaterThan(0);
    expect(reasons.length).toBeLessThanOrEqual(3);
  });

  it('states the headroom as money, not as a score', () => {
    // A profile the trip comes in under, so the sentence is about headroom.
    const generous = buildProfile({
      targetBudget: money(80000, 'EUR'),
      maxBudget: money(120_000, 'EUR'),
    });

    const [budget] = explainTrip(buildRankedTrip(), generous);

    // The figure is the constraint engine's, formatted - not a percentage
    // invented for the sentence.
    expect(budget?.text).toMatch(/€\d/);
    expect(budget?.text).toContain('under what you planned to spend');
    expect(budget?.text).not.toMatch(/score|factor|weight/i);
  });

  it('says plainly when a trip is over target rather than omitting it', () => {
    // A trip over target that is still shown is shown for some other reason.
    // Hiding the overspend would make the rest of the explanation dishonest.
    const tight = buildProfile({
      targetBudget: money(30000, 'EUR'),
      maxBudget: money(200_000, 'EUR'),
    });

    const [budget] = explainTrip(buildRankedTrip(), tight);

    expect(budget?.source).toBe('budget');
    expect(budget?.text).toContain('over your target');
  });

  it('never mentions a factor the trip is not actually strong on', () => {
    const trip = buildRankedTrip();
    const reasons = explainTrip(trip, profile);

    for (const reason of reasons) {
      if (reason.source === 'budget' || reason.source === 'fallback') continue;

      const factor = trip.score.factors.find((entry) => entry.key === reason.source);
      expect(factor, `mentioned ${reason.source} with no such factor`).toBeDefined();
      expect(factor!.value).toBeGreaterThanOrEqual(0.75);
    }
  });

  it('has something honest to say about an unremarkable trip', () => {
    // A trip with nothing notable still needs a sentence, and inventing a
    // strength would be the one thing worse than saying so.
    const trip = buildRankedTrip();
    const overTarget = buildProfile({
      targetBudget: money(1, 'EUR'),
      maxBudget: money(500_000, 'EUR'),
    });

    expect(explainTrip(trip, overTarget).length).toBeGreaterThan(0);
  });

  it('is deterministic', () => {
    const trip = buildRankedTrip();
    expect(explainTrip(trip, profile)).toEqual(explainTrip(trip, profile));
  });
});

describe('summariseReasons', () => {
  it('reads as a sentence', () => {
    const summary = summariseReasons(explainTrip(buildRankedTrip(), profile));

    expect(summary.endsWith('.')).toBe(true);
    expect(summary[0]).toBe(summary[0]?.toUpperCase());
  });

  it('joins several reasons with an and', () => {
    const summary = summariseReasons([
      { source: 'a', text: 'one thing' },
      { source: 'b', text: 'another' },
    ]);

    expect(summary).toBe('One thing and another.');
  });

  it('handles a single reason without a stray conjunction', () => {
    expect(summariseReasons([{ source: 'a', text: 'one thing' }])).toBe('One thing.');
  });
});
