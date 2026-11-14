import { describe, expect, it } from 'vitest';
import {
  ARC_LIGHT_PERIOD_MS,
  ARC_STAGGER_MS,
  EASE_OUT_EXPO,
  EASE_OUT_QUART,
  SPIN_DEGREES_PER_SECOND,
  SPIN_RAMP_MS,
  SPIN_RESUME_DELAY_MS,
  arcLightFraction,
  changedPins,
  cubicBezier,
  heroDiameter,
  spinFactor,
} from './globe-motion';

describe('cubicBezier', () => {
  it('starts at 0 and ends at 1', () => {
    for (const ease of [EASE_OUT_QUART, EASE_OUT_EXPO]) {
      expect(ease(0)).toBe(0);
      expect(ease(1)).toBe(1);
    }
  });

  it('is an ease-out: well past halfway at the halfway mark, and never backwards', () => {
    for (const ease of [EASE_OUT_QUART, EASE_OUT_EXPO]) {
      expect(ease(0.5)).toBeGreaterThan(0.8);

      let previous = 0;
      for (let step = 1; step <= 100; step += 1) {
        const value = ease(step / 100);
        expect(value).toBeGreaterThanOrEqual(previous - 1e-9);
        previous = value;
      }
    }
  });

  it('is linear when the control points are on the diagonal', () => {
    const linear = cubicBezier(0, 0, 1, 1);
    expect(linear(0.3)).toBeCloseTo(0.3, 3);
  });
});

describe('idle rotation', () => {
  it('is one turn in 240 seconds', () => {
    expect(SPIN_DEGREES_PER_SECOND * 240).toBeCloseTo(360, 10);
  });

  it('waits three seconds after an interaction, then ramps up over 1200ms', () => {
    expect(spinFactor(0)).toBe(0);
    expect(spinFactor(SPIN_RESUME_DELAY_MS)).toBe(0);
    expect(spinFactor(SPIN_RESUME_DELAY_MS + SPIN_RAMP_MS / 2)).toBeGreaterThan(0);
    expect(spinFactor(SPIN_RESUME_DELAY_MS + SPIN_RAMP_MS / 2)).toBeLessThan(1);
    expect(spinFactor(SPIN_RESUME_DELAY_MS + SPIN_RAMP_MS)).toBe(1);
    expect(spinFactor(60_000)).toBe(1);
  });
});

describe('arcLightFraction', () => {
  it('staggers each route by 600ms and repeats every 4 seconds', () => {
    expect(arcLightFraction(0, 0)).toBe(0);
    expect(arcLightFraction(ARC_STAGGER_MS - 1, 1)).toBeNull();
    expect(arcLightFraction(ARC_STAGGER_MS, 1)).toBe(0);
    expect(arcLightFraction(ARC_LIGHT_PERIOD_MS / 2, 0)).toBeCloseTo(0.5, 10);
    expect(arcLightFraction(ARC_LIGHT_PERIOD_MS + 1000, 0)).toBeCloseTo(0.25, 10);
  });
});

describe('heroDiameter', () => {
  it('is min(92vh, 78vw) on a desktop', () => {
    expect(heroDiameter(1440, 900)).toBeCloseTo(828, 6);
    expect(heroDiameter(1000, 1400)).toBeCloseTo(780, 6);
  });

  it('is 118vw on a phone', () => {
    expect(heroDiameter(390, 844)).toBeCloseTo(460.2, 6);
  });
});

describe('changedPins', () => {
  const now = [
    { destination: 'AYT', label: 'from EUR 120.00' },
    { destination: 'LCA', label: 'from EUR 200.00' },
    { destination: 'FAO', label: '' },
  ];

  it('pulses nothing on a first visit', () => {
    expect(changedPins(null, now)).toEqual([]);
  });

  it('pulses only pins whose price differs from the last view', () => {
    const seen = { AYT: 'from EUR 120.00', LCA: 'from EUR 180.00', FAO: 'from EUR 90.00' };
    expect(changedPins(seen, now)).toEqual(['LCA']);
  });

  it('does not pulse a destination that was not seen before', () => {
    expect(changedPins({ AYT: 'from EUR 120.00' }, now)).toEqual([]);
  });
});
