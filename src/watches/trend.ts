import { subtract, type Money } from '@/core/money';
import type { IsoDateTime } from '@/core/trip/types';
import type { PriceObservationRecord } from '@/db/repository';

/**
 * How a watched trip's price has moved, check by check.
 *
 * Each check records the whole-trip total of every trip it found, all under
 * the one time the check ran. The series a person wants is the cheapest trip
 * each time we looked: one point per check, in order. Nothing here is
 * interpolated or smoothed - a check that found nothing is simply not a
 * point - and nothing is predicted. The change is the latest cheapest less
 * the first, by `subtract`, in the watch's own currency; observations in any
 * other currency are left out rather than converted.
 */

export interface TrendPoint {
  readonly observedAt: IsoDateTime;
  readonly lowest: Money;
}

export interface PriceTrend {
  readonly points: readonly TrendPoint[];
  /** Latest less first, or null with fewer than two checks. */
  readonly change: Money | null;
}

export function priceTrend(
  history: readonly Pick<PriceObservationRecord, 'componentType' | 'amount' | 'observedAt'>[],
  currency: string,
): PriceTrend {
  const byCheck = new Map<IsoDateTime, Money>();

  for (const observation of history) {
    if (observation.componentType !== 'trip_total') continue;
    if (observation.amount.currency !== currency) continue;

    const current = byCheck.get(observation.observedAt);
    if (!current || observation.amount.amount < current.amount) {
      byCheck.set(observation.observedAt, observation.amount);
    }
  }

  const points = [...byCheck.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([observedAt, lowest]) => ({ observedAt, lowest }));

  return {
    points,
    change:
      points.length >= 2 ? subtract(points[points.length - 1]!.lowest, points[0]!.lowest) : null,
  };
}
