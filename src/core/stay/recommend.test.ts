import { describe, expect, it } from 'vitest';
import { pickRecommendations, type RecommendCandidate } from './recommend';

const make = (n: number, cities = 4, photoEvery = 1): RecommendCandidate[] =>
  Array.from({ length: n }, (_, i) => ({
    hotelKey: `h${i}`,
    cityCode: `C${i % cities}`,
    hasPhoto: i % photoEvery === 0,
  }));

const keys = (l: readonly RecommendCandidate[]) => l.map((c) => c.hotelKey);

describe('pickRecommendations', () => {
  it('is deterministic for the same seed', () => {
    const c = make(12);
    const a = pickRecommendations(c, { seed: 's1', count: 6 });
    const b = pickRecommendations(c, { seed: 's1', count: 6 });
    expect(keys(a)).toEqual(keys(b));
  });

  it('gives a different order for different seeds', () => {
    const c = make(12, 12);
    const a = pickRecommendations(c, { seed: 'alpha', count: 8 });
    const b = pickRecommendations(c, { seed: 'beta', count: 8 });
    expect(keys(a)).not.toEqual(keys(b));
  });

  it('never returns an excluded key', () => {
    const c = make(10);
    const out = pickRecommendations(c, { seed: 's', exclude: ['h0', 'h1', 'h2'], count: 10 });
    for (const k of ['h0', 'h1', 'h2']) expect(keys(out)).not.toContain(k);
  });

  it('keeps one hotel per city while several cities remain', () => {
    const out = pickRecommendations(make(12, 4), { seed: 's', count: 4 });
    expect(new Set(out.map((c) => c.cityCode)).size).toBe(4);
  });

  it('allows repeats when only one city exists', () => {
    const out = pickRecommendations(make(5, 1), { seed: 's', count: 3 });
    expect(out).toHaveLength(3);
  });

  it('puts candidates with a photo first', () => {
    const out = pickRecommendations(make(12, 12, 2), { seed: 's', count: 12 });
    const flags = out.map((c) => c.hasPhoto);
    expect(flags.indexOf(false)).toBeGreaterThanOrEqual(flags.lastIndexOf(true));
  });

  it('does not mutate the input', () => {
    const c = make(8);
    const copy = c.map((x) => ({ ...x }));
    pickRecommendations(c, { seed: 's', exclude: ['h1'], count: 5 });
    expect(c).toEqual(copy);
  });

  it('respects count', () => {
    expect(pickRecommendations(make(10), { seed: 's', count: 3 })).toHaveLength(3);
    expect(pickRecommendations(make(2), { seed: 's', count: 5 })).toHaveLength(2);
    expect(pickRecommendations(make(5), { seed: 's', count: 0 })).toEqual([]);
  });
});
