import { describe, expect, it } from 'vitest';
import { cheapestTripStatement, costCoverage, describeExclusions } from './coverage';

describe('costCoverage', () => {
  it('is all in only when nothing was excluded', () => {
    expect(costCoverage([])).toEqual({ allIn: true, excluded: [] });
    expect(costCoverage([{ category: 'transfer' }]).allIn).toBe(false);
  });

  it('names each excluded category once', () => {
    expect(costCoverage([{ category: 'transfer' }, { category: 'transfer' }]).excluded).toEqual([
      'transfer',
    ]);
  });
});

describe('describeExclusions', () => {
  it('says nothing when nothing is excluded', () => {
    expect(describeExclusions([])).toBeNull();
  });

  it('leads with flights only when the stay is the missing part', () => {
    expect(describeExclusions(['hotel'])).toBe('Flights only — stay not included');
    expect(describeExclusions(['transfer', 'hotel'])).toBe(
      'Flights only — airport transfer and stay not included',
    );
  });

  it('names a missing transfer on its own', () => {
    expect(describeExclusions(['transfer'])).toBe('Airport transfer not included');
  });

  it('falls back to a generic phrase for a category it has no name for', () => {
    expect(describeExclusions(['food'])).toBe('Some costs not included');
  });
});

describe('cheapestTripStatement', () => {
  it('says "all in" when no line was excluded', () => {
    expect(cheapestTripStatement([])).toBe('Cheapest trip found here, all in.');
  });

  it('never says "all in" when anything was excluded', () => {
    for (const excluded of [['hotel'], ['transfer'], ['hotel', 'transfer'], ['food']] as const) {
      expect(cheapestTripStatement(excluded)).not.toMatch(/all in/i);
    }
    expect(cheapestTripStatement(['hotel'])).toBe(
      'Cheapest trip found here. Flights only — stay not included.',
    );
  });
});
