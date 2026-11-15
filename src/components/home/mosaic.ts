/**
 * The editorial mosaic's arithmetic: how many cards it shows, and where each goes.
 *
 * The grid is twelve columns. One lead tile (7 wide, two rows tall) sits beside
 * two 5-wide tiles; what follows is a row of three 4-wide tiles, or a pair of
 * 6-wide ones. Those are the only shapes that never leave a card alone on a
 * row, which is why only 3, 5, 6 and 8 cards are valid.
 */

export type MosaicSlot = 'lead' | 'five' | 'four' | 'six';

/** Counts the grid can fill exactly. */
export const MOSAIC_COUNTS = [8, 6, 5, 3] as const;

/**
 * How many of `available` cards the mosaic should take, or 0 when the rail
 * should carry them all instead (fewer than three).
 */
export function mosaicCount(available: number): number {
  return MOSAIC_COUNTS.find((count) => count <= available) ?? 0;
}

/** The slot of each of `count` cards, in order. `count` must be a valid mosaic count. */
export function mosaicSlots(count: number): readonly MosaicSlot[] {
  if (!(MOSAIC_COUNTS as readonly number[]).includes(count)) return [];

  const slots: MosaicSlot[] = ['lead', 'five', 'five'];
  const rest = count - 3;

  if (rest === 5) {
    slots.push('four', 'four', 'four', 'six', 'six');
  } else if (rest === 3) {
    slots.push('four', 'four', 'four');
  } else if (rest === 2) {
    slots.push('six', 'six');
  }

  return slots;
}
