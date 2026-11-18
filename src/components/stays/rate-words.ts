import { format } from '@/core/money';
import type { BoardType, StayRate } from '@/core/stay/types';

export const BOARD_LABEL: Record<BoardType, string> = {
  room_only: 'Room only',
  breakfast: 'Breakfast included',
  half_board: 'Half board',
  full_board: 'Full board',
  all_inclusive: 'All inclusive',
};

/** Cancellation in one phrase, including the phrase for "we do not know". */
export function cancellationLabel(rate: StayRate): string {
  if (rate.cancellation.refundable === null) return 'Cancellation terms not stated';

  return rate.cancellation.refundable ? 'Free cancellation' : 'Non-refundable';
}

/**
 * What a rate says about tax, as lines of text. Values are used as given: the
 * included amount is information about the total, and the amount payable at the
 * property is never part of it. Both null is said as unknown, not as none.
 */
export function taxLines(rate: StayRate): string[] {
  const lines: string[] = [];

  if (rate.taxesAndFees) lines.push(`Includes taxes (${format(rate.taxesAndFees)})`);

  if (rate.payableAtProperty) {
    lines.push(
      `Payable at the hotel: ${format(rate.payableAtProperty)} (not part of the price shown)`,
    );
  }

  return lines.length > 0 ? lines : ['Taxes not stated'];
}
