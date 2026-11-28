import type { IsoDate, IsoDateTime } from '@/core/trip/types';

/**
 * The nightly past-departure cleanup, decided. Pure: the rows and today's date are passed in,
 * nothing reads a clock or a database.
 *
 * A stored lookup whose departure date is before today can never be bought again, so it goes.
 * What a price-drop alert still needs from it is a baseline, kept as one aggregate per route,
 * month of departure and currency: the median and minimum of the cheapest price in each lookup,
 * and how many lookups that was. The aggregates are computed from the rows about to be deleted,
 * so deleting never loses a baseline.
 *
 * All prices are integer minor units; the median of an even count is the floor of the mean of
 * the two middle values, so no float ever reaches a stored price.
 */

export interface PrunableRow {
  readonly origin: string;
  readonly destination: string;
  readonly departureDate: IsoDate;
  readonly currency: string;
  /** The mapped offers, as stored. Read defensively: it is JSON from a database. */
  readonly offers: unknown;
}

export interface RouteAggregate {
  readonly origin: string;
  readonly destination: string;
  /** Month of departure, `YYYY-MM`. */
  readonly month: string;
  readonly currency: string;
  readonly medianMinor: number;
  readonly minMinor: number;
  readonly sampleCount: number;
  readonly computedAt: IsoDateTime;
}

export interface PruneResult<TRow extends PrunableRow> {
  readonly toDelete: readonly TRow[];
  readonly keep: readonly TRow[];
  readonly aggregates: readonly RouteAggregate[];
}

/** The cheapest offer's price in the row's own currency, or null when there is none to read. */
export function cheapestMinor(row: PrunableRow): number | null {
  if (!Array.isArray(row.offers)) return null;
  let best: number | null = null;
  for (const offer of row.offers as unknown[]) {
    const price = (offer as { price?: { amount?: unknown; currency?: unknown } } | null)?.price;
    if (!price || !Number.isSafeInteger(price.amount) || price.currency !== row.currency) continue;
    const amount = price.amount as number;
    if (best === null || amount < best) best = amount;
  }
  return best;
}

export function medianMinor(sorted: readonly number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : Math.floor(((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2);
}

export function pruneRows<TRow extends PrunableRow>(
  rows: readonly TRow[],
  today: IsoDate,
  computedAt: IsoDateTime,
): PruneResult<TRow> {
  // Calendar dates compare correctly as YYYY-MM-DD strings.
  const toDelete = rows.filter((row) => row.departureDate < today);
  const keep = rows.filter((row) => row.departureDate >= today);

  const groups = new Map<string, { base: PrunableRow; month: string; prices: number[] }>();
  for (const row of toDelete) {
    const price = cheapestMinor(row);
    if (price === null) continue;
    const month = row.departureDate.slice(0, 7);
    const key = [row.origin, row.destination, month, row.currency].join('|');
    const group = groups.get(key) ?? { base: row, month, prices: [] };
    group.prices.push(price);
    groups.set(key, group);
  }

  const aggregates = [...groups.values()]
    .map(({ base, month, prices }): RouteAggregate => {
      const sorted = [...prices].sort((a, b) => a - b);
      return {
        origin: base.origin,
        destination: base.destination,
        month,
        currency: base.currency,
        medianMinor: medianMinor(sorted),
        minMinor: sorted[0] as number,
        sampleCount: sorted.length,
        computedAt,
      };
    })
    .sort((a, b) =>
      `${a.origin}${a.destination}${a.month}${a.currency}`.localeCompare(
        `${b.origin}${b.destination}${b.month}${b.currency}`,
      ),
    );

  return { toDelete, keep, aggregates };
}

/**
 * Fold a new aggregate into one already stored for the same bucket (a month is cleaned over
 * several nights). Minimum and count combine exactly; the median becomes the count-weighted mean
 * of the two medians, rounded down, because a true median cannot be rebuilt from two medians.
 */
export function mergeAggregate(
  stored: Pick<RouteAggregate, 'medianMinor' | 'minMinor' | 'sampleCount'>,
  added: RouteAggregate,
): RouteAggregate {
  const count = stored.sampleCount + added.sampleCount;
  return {
    ...added,
    medianMinor: Math.floor(
      (stored.medianMinor * stored.sampleCount + added.medianMinor * added.sampleCount) / count,
    ),
    minMinor: Math.min(stored.minMinor, added.minMinor),
    sampleCount: count,
  };
}
