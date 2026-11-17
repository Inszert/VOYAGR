import { ageOf, freshnessOf } from '@/core/freshness';
import type { IsoDateTime } from '@/core/trip/types';

/**
 * How current a stored snapshot row is, and the exact words a visitor reads for it.
 *
 * Pure. Everything is a function of the refresh interval, so changing refreshes a day changes
 * what "fresh" means in one place:
 *
 *   interval = 24 h / refreshes a day            (8 h at the default of 3)
 *   fresh    = age at most 2 x interval          (16 h)
 *   expires  = observed + 3 x interval           (24 h), after which the row is "missing"
 */

const HOUR_MS = 3_600_000;

export type SnapshotState = 'fresh' | 'aging' | 'missing' | 'unknown';

export interface SnapshotStaleness {
  readonly state: SnapshotState;
  readonly observedAt: IsoDateTime | null;
  /** Whole hours old, or null when the row is missing or its age is not believed. */
  readonly ageHours: number | null;
}

export function intervalHours(refreshesPerDay: number): number {
  return 24 / refreshesPerDay;
}

/** The oldest a row may be and still read "Updated N hours ago". */
export function freshLimitMs(refreshesPerDay: number): number {
  return 2 * intervalHours(refreshesPerDay) * HOUR_MS;
}

/** How long after observation a stored row stops being served at all. */
export function snapshotTtlMs(refreshesPerDay: number): number {
  return 3 * intervalHours(refreshesPerDay) * HOUR_MS;
}

export function classifySnapshot(
  row: { readonly observedAt: IsoDateTime; readonly expiresAt: IsoDateTime } | null,
  now: number,
  refreshesPerDay: number,
): SnapshotStaleness {
  if (!row) return { state: 'missing', observedAt: null, ageHours: null };

  // Past its own expiry the row is gone, whatever its age.
  if (Date.parse(row.expiresAt) <= now)
    return { state: 'missing', observedAt: null, ageHours: null };

  const freshness = freshnessOf(row.observedAt, now, { maxAgeMs: freshLimitMs(refreshesPerDay) });
  const age = ageOf(row.observedAt, now);

  // Observed in the future (or undated): the price may show, an age claim may not.
  if (freshness === 'unknown' || age === null) {
    return { state: 'unknown', observedAt: row.observedAt, ageHours: null };
  }

  return {
    state: freshness === 'fresh' ? 'fresh' : 'aging',
    observedAt: row.observedAt,
    ageHours: Math.floor(Math.max(0, age) / HOUR_MS),
  };
}

export const MISSING_LINE = 'Hotel prices are not loaded for these dates yet.';

function hoursAgo(hours: number): string {
  if (hours < 1) return 'less than an hour ago';
  return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
}

/**
 * The sentence for a state, or null when none may be said (`unknown` makes no age claim).
 * `missing` returns its sentence too: the page shows it with no price.
 */
export function stalenessLine(staleness: SnapshotStaleness): string | null {
  switch (staleness.state) {
    case 'fresh':
      return `Updated ${hoursAgo(staleness.ageHours ?? 0)}`;
    case 'aging':
      return `Prices last checked ${hoursAgo(staleness.ageHours ?? 0)}`;
    case 'missing':
      return MISSING_LINE;
    case 'unknown':
      return null;
  }
}
