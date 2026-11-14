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
  insideBox,
  labelFlips,
  labelShown,
  labelLimit,
  arcTargetOpacity,
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
  it('is min(96vh, 62vw) from 1024px, right of centre', () => {
    expect(heroDiameter(1440, 900)).toBeCloseTo(864, 6);
    expect(heroDiameter(1100, 1400)).toBeCloseTo(682, 6);
  });

  it('is min(92vh, 78vw) between a phone and a desktop', () => {
    expect(heroDiameter(800, 1000)).toBeCloseTo(624, 6);
  });

  it('is 118vw on a phone', () => {
    expect(heroDiameter(390, 844)).toBeCloseTo(460.2, 6);
  });
});

describe('labelLimit', () => {
  it('is five labels on a screen and three on a phone', () => {
    expect(labelLimit(1440)).toBe(5);
    expect(labelLimit(639)).toBe(3);
  });
});

describe('labelFlips', () => {
  const base = { boxLeft: 0, boxRight: 390, viewportWidth: 390, labelWidth: 150 };

  it('stays on the right of its pin when it fits', () => {
    expect(labelFlips({ ...base, anchorX: 100 })).toBe(false);
  });

  it('turns to the left when it would run off the right edge', () => {
    expect(labelFlips({ ...base, anchorX: 300 })).toBe(true);
  });

  it('stays put when turning round would run off the left edge instead', () => {
    expect(labelFlips({ ...base, anchorX: 120, labelWidth: 300 })).toBe(false);
  });

  it('measures against the viewport when the box is wider than it', () => {
    expect(labelFlips({ ...base, boxRight: 600, anchorX: 300 })).toBe(true);
  });
});

describe('labelFlips away from the arc', () => {
  const base = { boxLeft: 0, boxRight: 1000, viewportWidth: 1000, labelWidth: 120 };

  it('goes to the left of the pin when the home airport is to its right', () => {
    expect(labelFlips({ ...base, anchorX: 500, preferLeft: true })).toBe(true);
  });

  it('still stays on the right when there is no room on the left', () => {
    expect(labelFlips({ ...base, anchorX: 60, preferLeft: true })).toBe(false);
  });
});

describe('labelShown', () => {
  it('is all or nothing', () => {
    expect(labelShown(0.9)).toBe(true);
    expect(labelShown(0.25)).toBe(true);
    expect(labelShown(0.249)).toBe(false);
    expect(labelShown(-1)).toBe(false);
  });
});

describe('insideBox', () => {
  const stage = { left: 0, right: 100, top: 0, bottom: 100 };

  it('is true only when the whole box is inside', () => {
    expect(insideBox({ left: 10, right: 50, top: 10, bottom: 40 }, stage)).toBe(true);
    expect(insideBox({ left: 10, right: 50, top: 80, bottom: 101 }, stage)).toBe(false);
    expect(insideBox({ left: -1, right: 50, top: 10, bottom: 40 }, stage)).toBe(false);
  });
});

describe('arcTargetOpacity', () => {
  const keys = ['TBS-0', 'BUS-0', 'VIE-BOS-branch'];

  it('shows every arc when nothing is selected', () => {
    expect(arcTargetOpacity(keys, 'BUS-0', null)).toBe(1);
  });

  it('shows only the selected destination, and fades the rest', () => {
    expect(arcTargetOpacity(keys, 'TBS-0', 'TBS')).toBe(1);
    expect(arcTargetOpacity(keys, 'BUS-0', 'TBS')).toBe(0);
  });

  it('counts a branch of a trunk as the destination own arc', () => {
    expect(arcTargetOpacity(keys, 'VIE-BOS-branch', 'BOS')).toBe(1);
    expect(arcTargetOpacity(keys, 'TBS-0', 'BOS')).toBe(0);
  });

  it('hides nothing when the selected destination has no arc to show', () => {
    expect(arcTargetOpacity(keys, 'BUS-0', 'ZZZ')).toBe(1);
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
