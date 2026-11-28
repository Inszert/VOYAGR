/** Self-transfer risk: separate tickets mean no protection if the first leg is late. */
export const SELF_TRANSFER_WARNING_KEY = 'hub.selfTransfer.separateTickets';

/**
 * The i18n key of the warning when the itinerary is more than one ticket, else
 * `null`. Returns the key only, never the copy. `separateTickets` is the number
 * of separately issued tickets the caller counted.
 */
export function selfTransferWarning(separateTickets: number): string | null {
  if (!Number.isInteger(separateTickets) || separateTickets < 0) {
    throw new RangeError('separateTickets must be a non-negative integer');
  }
  return separateTickets > 1 ? SELF_TRANSFER_WARNING_KEY : null;
}
