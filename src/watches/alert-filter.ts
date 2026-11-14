import { isAfter, isBefore } from '@/core/dates';
import { lessThanOrEqual, type Money } from '@/core/money';
import type { AlertPreferencesRecord } from '@/db/repository';

/**
 * Does a user's own alert setting let this deal through?
 *
 * Runs after the deterministic core has decided a drop is material - the bar
 * for "worth an alert" is `detectDeal`, the same one the watch pipeline has
 * always used, and nothing here adds a threshold of its own. This can only
 * narrow: a trip the user excluded is not alerted, and nothing is ever alerted
 * that the core did not already pass.
 *
 * No record means no narrowing and alerts on, which is what every user had
 * before the settings existed.
 */

export interface AlertCandidate {
  readonly destination: string;
  readonly departureDate: string;
  readonly total: Money;
}

export type AlertFilterReason =
  'alerts-off' | 'destination' | 'over-budget' | 'before-window' | 'after-window';

export function filterAlert(
  preferences: AlertPreferencesRecord | null,
  trip: AlertCandidate,
): { allowed: true } | { allowed: false; reason: AlertFilterReason } {
  if (!preferences) return { allowed: true };

  if (!preferences.priceDropAlerts) return { allowed: false, reason: 'alerts-off' };

  if (preferences.destinations.length > 0 && !preferences.destinations.includes(trip.destination)) {
    return { allowed: false, reason: 'destination' };
  }

  // A budget in another currency cannot be compared without a rate, and a rate is
  // data, never a guess - so it does not filter rather than filtering wrongly.
  const { budget } = preferences;
  if (budget && budget.currency === trip.total.currency && !lessThanOrEqual(trip.total, budget)) {
    return { allowed: false, reason: 'over-budget' };
  }

  const { earliestDeparture, latestDeparture } = preferences;
  if (earliestDeparture && isBefore(trip.departureDate, earliestDeparture)) {
    return { allowed: false, reason: 'before-window' };
  }
  if (latestDeparture && isAfter(trip.departureDate, latestDeparture)) {
    return { allowed: false, reason: 'after-window' };
  }

  return { allowed: true };
}
