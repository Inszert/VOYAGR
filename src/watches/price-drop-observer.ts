import type { RouteObservation } from '@/core/alerts/baseline';
import { BASELINE_WINDOW_DAYS } from '@/core/alerts/constants';
import type { Repositories } from '@/db/repository';
import type { EmailProvider } from '@/email/types';
import { getLogger } from '@/lib/logger';
import { raisePriceDropAlert } from '@/notifications/price-drop';
import type { NotificationChannel } from '@/notifications/types';
import type { KiwiFreshObservation } from '@/providers/flights/kiwi-read-path';

/**
 * Records a price observation when a lookup really happened, and raises price-drop alerts.
 *
 * The only caller is the 12-hour read path's `onFreshObservation`, which fires after a fresh MCP
 * answer is stored. A cache or row hit never reaches here, and nothing in this module is on a
 * timer. Alert quality therefore depends on usage: a route nobody looks up builds no baseline.
 *
 * The observation store is in process memory. A restart loses the baseline (no alert until five
 * lookups accumulate again); a durable store is a later slice.
 */

const log = getLogger('watches.price-drop-observer');
const DAY_MS = 24 * 60 * 60 * 1000;

/** Observations per route key, `ORIGIN-DESTINATION-YYYY-MM`. */
export class RouteObservationStore {
  private readonly byRoute = new Map<string, RouteObservation[]>();

  add(routeKey: string, observation: RouteObservation): void {
    const list = this.byRoute.get(routeKey) ?? [];
    list.push(observation);
    this.byRoute.set(routeKey, list);
  }

  list(routeKey: string): readonly RouteObservation[] {
    return this.byRoute.get(routeKey) ?? [];
  }

  /** Drops what no baseline can use any more. Called on each write. */
  prune(nowIso: string): void {
    const cutoff = Date.parse(nowIso) - BASELINE_WINDOW_DAYS * DAY_MS;
    for (const [key, list] of this.byRoute) {
      const kept = list.filter((o) => Date.parse(o.observedAt) >= cutoff);
      if (kept.length === 0) this.byRoute.delete(key);
      else this.byRoute.set(key, kept);
    }
  }
}

export interface PriceDropObserverDeps {
  readonly repositories: () => Repositories;
  readonly emailProvider: () => EmailProvider;
  readonly store?: RouteObservationStore;
  readonly channel?: NotificationChannel;
}

export function createPriceDropObserver(
  deps: PriceDropObserverDeps,
): (observation: KiwiFreshObservation) => Promise<void> {
  const store = deps.store ?? new RouteObservationStore();

  return async ({ key, offers, observedAt }) => {
    // The cheapest priced offer of this lookup in the lookup's currency. Integer minor units.
    let cheapest: number | null = null;
    for (const offer of offers) {
      if (offer.price.currency.toUpperCase() !== key.currency) continue;
      if (!Number.isInteger(offer.price.amount) || offer.price.amount <= 0) continue;
      if (cheapest === null || offer.price.amount < cheapest) cheapest = offer.price.amount;
    }
    if (cheapest === null) return;

    const month = key.departureDate.slice(0, 7);
    const routeKey = `${key.origin}-${key.destination}-${month}`;
    const latest: RouteObservation = {
      id: `${routeKey}@${observedAt}`,
      cheapestMinor: cheapest,
      currency: key.currency,
      observedAt,
      month,
    };
    store.prune(observedAt);
    store.add(routeKey, latest);

    const repositories = deps.repositories();
    const watches = await repositories.travelWatches.listActive();
    for (const watch of watches) {
      try {
        const search = await repositories.tripSearches.findById(watch.tripSearchId);
        if (!search) continue;
        const origins = search.profile?.origins ?? [];
        if (!origins.includes(key.origin) || !search.destinations.includes(key.destination)) {
          continue;
        }
        await raisePriceDropAlert({
          repositories,
          watch,
          routeKey,
          observations: store.list(routeKey),
          latest,
          now: observedAt,
          emailProvider: deps.emailProvider(),
          ...(deps.channel ? { channel: deps.channel } : {}),
        });
      } catch (error) {
        log.warn({ err: error, watchId: watch.id }, 'price-drop check failed for a watch');
      }
    }
  };
}
