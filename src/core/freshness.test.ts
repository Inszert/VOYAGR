import { describe, expect, it } from 'vitest';
import { ageOf, freshnessOf, instantOf, weakestFreshness } from './freshness';
import type { IsoDateTime } from './trip/types';

const NOW = Date.parse('2026-09-22T12:00:00Z');
const limits = { maxAgeMs: 30 * 60_000 };

const at = (value: string) => value as IsoDateTime;

describe('freshnessOf', () => {
  it('calls a recent observation fresh', () => {
    expect(freshnessOf(at('2026-09-22T11:45:00Z'), NOW, limits)).toBe('fresh');
  });

  it('calls a quote stale once the vendor says it has expired, however young', () => {
    expect(freshnessOf(at('2026-09-22T11:45:00Z'), NOW, limits, at('2026-09-22T11:55:00Z'))).toBe(
      'stale',
    );
  });

  it('keeps a young quote fresh while the vendor still stands behind it', () => {
    expect(freshnessOf(at('2026-09-22T11:45:00Z'), NOW, limits, at('2026-09-22T12:20:00Z'))).toBe(
      'fresh',
    );
  });

  it('never lets a vendor promise make an old observation fresh', () => {
    expect(freshnessOf(at('2026-09-22T06:00:00Z'), NOW, limits, at('2026-09-23T12:00:00Z'))).toBe(
      'stale',
    );
  });

  it('treats an unstated expiry as no information, not as expired', () => {
    expect(freshnessOf(at('2026-09-22T11:45:00Z'), NOW, limits, null)).toBe('fresh');
  });

  it('calls an observation past the limit stale', () => {
    expect(freshnessOf(at('2026-09-22T11:00:00Z'), NOW, limits)).toBe('stale');
  });

  it('treats the limit itself as still fresh', () => {
    expect(freshnessOf(at('2026-09-22T11:30:00Z'), NOW, limits)).toBe('fresh');
  });

  it('calls a missing timestamp unknown, never stale', () => {
    // Silence is its own case. Treating it as old is a claim we cannot
    // support, in exactly the way treating it as fresh would be.
    expect(freshnessOf(null, NOW, limits)).toBe('unknown');
    expect(freshnessOf(undefined, NOW, limits)).toBe('unknown');
    expect(freshnessOf(at(''), NOW, limits)).toBe('unknown');
  });

  it('calls an unparsable timestamp unknown rather than guessing at it', () => {
    expect(freshnessOf(at('last tuesday'), NOW, limits)).toBe('unknown');
    expect(freshnessOf(at('2026-13-45T99:00:00Z'), NOW, limits)).toBe('unknown');
  });

  it('allows small clock skew, so a vendor a few seconds ahead is still fresh', () => {
    expect(freshnessOf(at('2026-09-22T12:00:30Z'), NOW, limits)).toBe('fresh');
  });

  it('refuses a timestamp far in the future instead of calling it the freshest thing', () => {
    // An hour ahead is not skew, it is a bug or a mis-mapped timezone - and
    // the freshest-looking data would be the least trustworthy.
    expect(freshnessOf(at('2026-09-22T13:00:00Z'), NOW, limits)).toBe('unknown');
  });
});

describe('ageOf', () => {
  it('measures how old an observation is', () => {
    expect(ageOf(at('2026-09-22T11:00:00Z'), NOW)).toBe(60 * 60_000);
  });

  it('has no answer for an undated observation', () => {
    expect(ageOf(null, NOW)).toBeNull();
  });
});

describe('instantOf', () => {
  it('reads an instant and refuses anything that is not one', () => {
    expect(instantOf(at('2026-09-22T12:00:00Z'))).toBe(NOW);
    expect(instantOf(at('nonsense'))).toBeNull();
    expect(instantOf(null)).toBeNull();
  });
});

describe('weakestFreshness', () => {
  it('takes the weakest claim in the set', () => {
    // A trip is only as current as its stalest half.
    expect(weakestFreshness(['fresh', 'fresh'])).toBe('fresh');
    expect(weakestFreshness(['fresh', 'stale'])).toBe('stale');
    expect(weakestFreshness(['stale', 'unknown'])).toBe('unknown');
  });

  it('ranks unknown below stale', () => {
    // A figure we cannot date is a weaker claim than one we can date and
    // know to be old.
    expect(weakestFreshness(['unknown', 'stale', 'fresh'])).toBe('unknown');
  });

  it('calls an empty set fresh, because there is nothing old in it', () => {
    expect(weakestFreshness([])).toBe('fresh');
  });
});
