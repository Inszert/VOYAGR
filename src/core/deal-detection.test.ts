import { describe, expect, it } from 'vitest';
import { money } from './money';
import {
  clearsPersonalThreshold,
  DEFAULT_DEAL_THRESHOLDS,
  detectDeal,
  isAlertWorthy,
} from './deal-detection';

/**
 * Deal detection.
 *
 * The product promise being defended: we interrupt you when something actually
 * changed, and we leave you alone when it did not. Getting the second half
 * wrong is what turns a useful product into one people mute.
 */

const deal = (current: number, previous: number | null, currency = 'EUR') =>
  detectDeal({
    current: money(current, currency),
    previousBest: previous === null ? null : money(previous, currency),
  });

describe('changes that are not news', () => {
  it('treats the first observation as no news at all', () => {
    // "We found a trip" is not the same news as "it got cheaper", and there is
    // nothing for it to be cheaper than.
    const result = deal(68000, null);

    expect(result.material).toBe(false);
    expect(result.reason).toBe('first-observation');
  });

  it('says nothing when the price went up', () => {
    const result = deal(72000, 68000);

    expect(result.material).toBe(false);
    expect(result.reason).toBe('not-cheaper');
    expect(result.drop).toEqual(money(0, 'EUR'));
  });

  it('says nothing when the price is unchanged', () => {
    // The case that makes "exactly one alert" work: after alerting on a drop,
    // the next refresh sees the same number and stays quiet.
    expect(deal(68000, 68000).reason).toBe('not-cheaper');
  });

  it('ignores the specification’s own example: EUR 2 off EUR 240', () => {
    const result = deal(23800, 24000);

    expect(result.material).toBe(false);
    // It fails the absolute bar first, which is the cheaper check.
    expect(result.reason).toBe('below-absolute-threshold');
  });

  it('ignores a large share of a small number', () => {
    // 5% off EUR 60 is three euro. Percentage alone would call that news.
    const result = deal(5700, 6000);

    expect(result.material).toBe(false);
    expect(result.reason).toBe('below-absolute-threshold');
  });

  it('ignores a large sum that is a rounding error on a big trip', () => {
    // EUR 40 off EUR 4,000 clears the absolute bar and fails the relative one.
    const result = deal(396_000, 400_000);

    expect(result.material).toBe(false);
    expect(result.reason).toBe('below-relative-threshold');
  });

  it('does not mistake a currency change for a price drop', () => {
    const result = detectDeal({
      current: money(55000, 'GBP'),
      previousBest: money(68000, 'EUR'),
    });

    expect(result.material).toBe(false);
    expect(result.reason).toBe('currency-changed');
  });
});

describe('changes worth an alert', () => {
  it('reports a drop that clears both bars', () => {
    // EUR 50 off EUR 680 is 7.4%: past both minimums, short of important.
    const result = deal(63000, 68000);

    expect(result.material).toBe(true);
    expect(result.severity).toBe('interesting');
    expect(result.drop).toEqual(money(5000, 'EUR'));
    expect(result.reason).toBe('material-drop');
  });

  it('calls a large share important', () => {
    const result = deal(60000, 68000);

    expect(result.dropShare).toBeGreaterThanOrEqual(DEFAULT_DEAL_THRESHOLDS.importantDropShare);
    expect(result.severity).toBe('important');
  });

  it('calls a large absolute sum important even on an expensive trip', () => {
    // EUR 150 off EUR 2,000 is 7.5% - under the important share, but enough
    // money that burying it as "interesting" would be wrong.
    const result = deal(185_000, 200_000);

    expect(result.severity).toBe('important');
    expect(result.material).toBe(true);
  });

  it('reports the drop and its share so a message can be written from facts', () => {
    const result = deal(63000, 68000);

    expect(result.drop).toEqual(money(5000, 'EUR'));
    expect(Math.round(result.dropShare * 1000) / 1000).toBe(0.074);
  });
});

describe('thresholds are tunable', () => {
  it('honours a stricter configuration', () => {
    const strict = {
      ...DEFAULT_DEAL_THRESHOLDS,
      minimumDropShare: 0.25,
    };

    expect(
      detectDeal({ current: money(63000, 'EUR'), previousBest: money(68000, 'EUR') }).material,
    ).toBe(true);

    expect(
      detectDeal({
        current: money(63000, 'EUR'),
        previousBest: money(68000, 'EUR'),
        thresholds: strict,
      }).material,
    ).toBe(false);
  });

  it('exposes its defaults rather than hiding them in a comparison', () => {
    expect(DEFAULT_DEAL_THRESHOLDS.minimumDropMinorUnits).toBeGreaterThan(0);
    expect(DEFAULT_DEAL_THRESHOLDS.minimumDropShare).toBeGreaterThan(0);
    expect(DEFAULT_DEAL_THRESHOLDS.importantDropShare).toBeGreaterThan(
      DEFAULT_DEAL_THRESHOLDS.minimumDropShare,
    );
  });
});

describe('isAlertWorthy', () => {
  it('agrees with the verdict', () => {
    expect(isAlertWorthy(deal(63000, 68000))).toBe(true);
    expect(isAlertWorthy(deal(72000, 68000))).toBe(false);
    expect(isAlertWorthy(deal(68000, null))).toBe(false);
  });
});

describe('clearsPersonalThreshold', () => {
  const verdictFor = (current: number, previous: number) =>
    detectDeal({ current: money(current, 'EUR'), previousBest: money(previous, 'EUR') });

  it('lets a drop through that clears the traveller’s bar', () => {
    expect(clearsPersonalThreshold(verdictFor(50_000, 60_000), money(5_000, 'EUR'))).toBe(true);
  });

  it('holds back a drop the product would mention but the traveller asked not to hear about', () => {
    const verdict = verdictFor(57_000, 60_000);
    expect(verdict.material).toBe(true);
    expect(clearsPersonalThreshold(verdict, money(5_000, 'EUR'))).toBe(false);
  });

  it('keeps the product’s verdict when there is no bar, or one in another currency', () => {
    const verdict = verdictFor(57_000, 60_000);
    expect(clearsPersonalThreshold(verdict, null)).toBe(true);
    expect(clearsPersonalThreshold(verdict, money(5_000, 'GBP'))).toBe(true);
  });
});
