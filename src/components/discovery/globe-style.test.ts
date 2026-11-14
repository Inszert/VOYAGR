import { describe, expect, it } from 'vitest';
import { ROUTE_DASH_STEPS, routeDashPattern, warmEdge } from './globe-style';

describe('warmEdge', () => {
  it('tints the night towards the twilight and stays dark', () => {
    expect(warmEdge('#060914', '#f0a35c')).toBe('rgb(39, 31, 30)');
  });

  it('returns the night untouched when a colour cannot be read', () => {
    expect(warmEdge('#060914', 'oklch(0.78 0.14 58)')).toBe('#060914');
  });
});

/**
 * The marching route dash.
 *
 * Defended: however long a globe page lives, the animation hands MapLibre a
 * bounded set of dash arrays - an unbounded set filled its line atlas and made
 * every later frame throw - and every one keeps the line the same length.
 */
describe('routeDashPattern', () => {
  it('never produces more than a fixed set of patterns, however long it runs', () => {
    const seen = new Set<string>();
    // An hour of frames at 60 a second.
    for (let frame = 0; frame < 60 * 60 * 60; frame += 1) {
      seen.add(routeDashPattern(frame / 60).join(','));
    }

    expect(seen.size).toBeLessThanOrEqual(ROUTE_DASH_STEPS);
  });

  it('keeps the dash and its gaps the same total length', () => {
    for (const seconds of [0, 0.4, 1.3, 2.9, 17.2, 3600.05]) {
      const [lead, dash, gap] = routeDashPattern(seconds);
      expect(lead + dash + gap).toBeCloseTo(8, 10);
    }
  });

  it('still moves', () => {
    expect(routeDashPattern(0)).not.toEqual(routeDashPattern(0.5));
  });
});
