import { describe, expect, it } from 'vitest';
import { mosaicCount, mosaicSlots, type MosaicSlot } from './mosaic';

/** Columns a slot takes in the 12-column grid. */
const COLUMNS: Record<MosaicSlot, number> = { lead: 7, five: 5, four: 4, six: 6 };

describe('mosaic', () => {
  it.each([
    [0, 0],
    [1, 0],
    [2, 0],
    [3, 3],
    [4, 3],
    [5, 5],
    [6, 6],
    [7, 6],
    [8, 8],
    [16, 8],
  ])('takes the largest valid count that fits: %i available -> %i', (available, expected) => {
    expect(mosaicCount(available)).toBe(expected);
  });

  it.each([3, 5, 6, 8])('fills the twelve columns exactly with %i cards', (count) => {
    const slots = mosaicSlots(count);
    expect(slots).toHaveLength(count);

    // The lead and the two 5-wide tiles make two rows of 12; what follows
    // must make whole rows of 12 as well, so no card is ever on its own.
    const [lead, ...rest] = slots;
    expect(lead).toBe('lead');
    expect(rest.slice(0, 2)).toEqual(['five', 'five']);

    const after = rest.slice(2);
    expect(after.reduce((total, slot) => total + COLUMNS[slot], 0) % 12).toBe(0);
  });

  it('has no layout for a count that would leave an orphan', () => {
    for (const count of [0, 1, 2, 4, 7, 9]) expect(mosaicSlots(count)).toEqual([]);
  });
});
