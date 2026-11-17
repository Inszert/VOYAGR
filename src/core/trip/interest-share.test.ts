import { describe, expect, it } from 'vitest';
import { interestShares } from './interest-share';

describe('interestShares', () => {
  it('nature is outdoors plus beaches, food is food, both over every place with a kind', () => {
    const shares = interestShares({
      sights: 4,
      museums: 2,
      beaches: 1,
      outdoors: 2,
      neighbourhoods: 0,
      food: 1,
      culture: 0,
    });

    expect(shares.nature).toBeCloseTo(0.3);
    expect(shares.food).toBeCloseTo(0.1);
  });

  it('is null, not zero, when the cache had nothing', () => {
    expect(interestShares(null)).toEqual({ nature: null, food: null });
    expect(interestShares(undefined)).toEqual({ nature: null, food: null });
  });

  it('is null when no place has a kind', () => {
    expect(interestShares({ sights: 0, food: 0, beaches: 0 })).toEqual({
      nature: null,
      food: null,
    });
    expect(interestShares({})).toEqual({ nature: null, food: null });
  });

  it('is a real zero when places exist and none are of the kind', () => {
    expect(interestShares({ sights: 5 })).toEqual({ nature: 0, food: 0 });
  });

  it('stays within 0 to 1', () => {
    const shares = interestShares({ outdoors: 3, food: 3 });
    expect(shares.nature).toBe(0.5);
    expect(shares.food).toBe(0.5);
  });
});
