import { randomUUID } from 'node:crypto';
import { canCreateWatch, type Entitlements } from '@/core/entitlements';
import { minutesUntilRun, nextRunAt, type WatchPriority } from '@/core/watch-schedule';
import { AppError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import type { Repositories, TravelWatchRecord, TripSearchRecord } from '@/db/repository';
import type { SearchProfile } from '@/core/trip/types';
import type { AuthenticatedUser } from '@/auth/service';

/**
 * Saved searches and Travel Watches (implementation plan 1.5).
 *
 * A saved search is what the user asked for. A watch is a saved search the
 * system has agreed to keep looking at. Two records rather than a flag on one,
 * so a user can save something without committing a monitoring slot to it, and
 * can pause a watch without losing the search behind it.
 *
 * Every limit here is read from the user's entitlements, never written as a
 * constant. That is the rule §24.2 depends on: a paid tier has to be a new row
 * in the plan table, not a hunt through the code for the number 3.
 */

const log = getLogger('watches.service');

/** "In about 5 hours", "Due now" - never a bare timestamp nobody can parse. */
export function describeNextRun(watch: TravelWatchRecord, now: number): string {
  if (watch.status !== 'active') return 'Not scheduled while paused';

  const minutes = minutesUntilRun(watch.nextRunAt, now);
  if (minutes <= 0) return 'Due now';
  if (minutes < 60) return `In about ${minutes} minutes`;

  const hours = Math.round(minutes / 60);
  return `In about ${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}

export interface WatchWithSearch {
  readonly watch: TravelWatchRecord;
  readonly search: TripSearchRecord;
  /**
   * When this watch next runs, in words.
   *
   * Resolved here rather than in the component because this is where the clock
   * lives. A component that read `Date.now()` while rendering would be impure,
   * untestable without mocking time, and would disagree with itself between a
   * server render and a hydration.
   */
  readonly nextRunLabel: string;
}

export interface WatchDependencies {
  readonly repositories: Repositories;
  /** Injectable so a test can schedule without waiting for real time. */
  readonly now?: () => number;
}

export interface SaveSearchInput {
  readonly name: string;
  readonly profile: SearchProfile;
  readonly destinations: readonly string[];
}

export class WatchService {
  private readonly repositories: Repositories;
  private readonly now: () => number;

  constructor(dependencies: WatchDependencies) {
    this.repositories = dependencies.repositories;
    this.now = dependencies.now ?? Date.now;
  }

  /**
   * Save a search without watching it.
   *
   * @throws AppError FORBIDDEN when the plan's saved-search allowance is spent.
   */
  async saveSearch(user: AuthenticatedUser, input: SaveSearchInput): Promise<TripSearchRecord> {
    const name = input.name.trim();

    if (name.length === 0) {
      throw new AppError('VALIDATION_ERROR', 'A saved search needs a name', {
        publicMessage: 'Give this search a name.',
      });
    }

    if (input.destinations.length === 0) {
      throw new AppError('VALIDATION_ERROR', 'A saved search needs a destination', {
        publicMessage: 'A saved search needs at least one destination.',
      });
    }

    const existing = await this.repositories.tripSearches.listByUser(user.id);
    if (existing.length >= user.entitlements.maxSavedSearches) {
      throw new AppError('FORBIDDEN', 'Saved search allowance exhausted', {
        publicMessage: `Your plan keeps ${user.entitlements.maxSavedSearches} saved searches. Delete one to save another.`,
      });
    }

    const search = await this.repositories.tripSearches.create({
      id: randomUUID(),
      userId: user.id,
      name,
      profile: input.profile,
      destinations: [...input.destinations],
    });

    log.info({ userId: user.id, searchId: search.id }, 'search saved');
    return search;
  }

  /**
   * Start watching a saved search.
   *
   * @throws AppError FORBIDDEN when the plan's active-watch limit is reached,
   *   NOT_FOUND when the search does not exist or is not this user's.
   */
  async startWatching(
    user: AuthenticatedUser,
    tripSearchId: string,
    priority: WatchPriority = 'normal',
  ): Promise<TravelWatchRecord> {
    const search = await this.repositories.tripSearches.findById(tripSearchId);

    // Ownership is checked here, not by whatever page linked here. Reporting
    // "not yours" as "not found" is deliberate: it tells a prober nothing.
    if (!search || search.userId !== user.id) {
      throw new AppError('NOT_FOUND', 'No such saved search for this user', {
        publicMessage: 'That saved search no longer exists.',
      });
    }

    const existing = await this.findWatchForSearch(user.id, tripSearchId);
    if (existing?.status === 'active') return existing;

    const active = await this.countActiveWatches(user.id);
    if (!canCreateWatch(active, user.entitlements)) {
      throw new AppError('FORBIDDEN', 'Active watch limit reached', {
        publicMessage: `Your plan watches ${user.entitlements.maxActiveWatches} trips at once. Pause one to watch another.`,
      });
    }

    // Resume rather than create a second watch for the same search: two would
    // double the provider calls and alert the user twice about one trip.
    if (existing) return this.setStatus(user, existing.id, 'active');

    const watch = await this.repositories.travelWatches.create({
      id: randomUUID(),
      userId: user.id,
      tripSearchId,
      status: 'active',
      priority: this.allowedPriority(priority, user.entitlements),
      lastRunAt: null,
      // Due immediately: someone who just asked to watch a trip expects the
      // first check now, not in six hours.
      nextRunAt: new Date(this.now()).toISOString(),
      bestKnownTotal: null,
    });

    log.info({ userId: user.id, watchId: watch.id, priority: watch.priority }, 'watch created');
    return watch;
  }

  /** Watches paired with the search each one replays. */
  async listForUser(userId: string): Promise<WatchWithSearch[]> {
    const [watches, searches] = await Promise.all([
      this.repositories.travelWatches.listByUser(userId),
      this.repositories.tripSearches.listByUser(userId),
    ]);

    const byId = new Map(searches.map((search) => [search.id, search]));

    const now = this.now();

    return watches.flatMap((watch) => {
      const search = byId.get(watch.tripSearchId);
      // A watch whose search is gone cannot be replayed or explained, so it is
      // not shown. The cascade should make this impossible; being defensive
      // costs nothing.
      return search ? [{ watch, search, nextRunLabel: describeNextRun(watch, now) }] : [];
    });
  }

  async setStatus(
    user: AuthenticatedUser,
    watchId: string,
    status: TravelWatchRecord['status'],
  ): Promise<TravelWatchRecord> {
    const watch = await this.requireOwnWatch(user, watchId);

    // Resuming spends a slot, so it is checked against the same limit that
    // creating one is. Pausing and archiving free a slot and never fail.
    if (status === 'active' && watch.status !== 'active') {
      const active = await this.countActiveWatches(user.id);
      if (!canCreateWatch(active, user.entitlements)) {
        throw new AppError('FORBIDDEN', 'Active watch limit reached', {
          publicMessage: `Your plan watches ${user.entitlements.maxActiveWatches} trips at once. Pause one to resume this.`,
        });
      }
    }

    const updated = await this.repositories.travelWatches.update(watchId, {
      status,
      // A watch resumed after a pause is checked promptly rather than waiting
      // out an interval that elapsed while it was asleep.
      ...(status === 'active' ? { nextRunAt: new Date(this.now()).toISOString() } : {}),
    });

    log.info({ userId: user.id, watchId, status }, 'watch status changed');
    return updated;
  }

  async setPriority(
    user: AuthenticatedUser,
    watchId: string,
    priority: WatchPriority,
  ): Promise<TravelWatchRecord> {
    await this.requireOwnWatch(user, watchId);

    return this.repositories.travelWatches.update(watchId, {
      priority: this.allowedPriority(priority, user.entitlements),
    });
  }

  /**
   * Record that a watch has run, and schedule the next check.
   *
   * The scheduler in 1.6 calls this. It lives here rather than in the worker so
   * that "when does this run next" has exactly one answer, derived from the
   * plan rather than from whatever the worker felt like.
   */
  async recordRun(
    watchId: string,
    entitlements: Entitlements,
    priority: WatchPriority,
  ): Promise<TravelWatchRecord> {
    const now = this.now();

    return this.repositories.travelWatches.update(watchId, {
      lastRunAt: new Date(now).toISOString(),
      nextRunAt: nextRunAt({ priority, entitlements, now }),
    });
  }

  private async countActiveWatches(userId: string): Promise<number> {
    const watches = await this.repositories.travelWatches.listByUser(userId);
    return watches.filter((watch) => watch.status === 'active').length;
  }

  private async findWatchForSearch(
    userId: string,
    tripSearchId: string,
  ): Promise<TravelWatchRecord | null> {
    const watches = await this.repositories.travelWatches.listByUser(userId);
    return watches.find((watch) => watch.tripSearchId === tripSearchId) ?? null;
  }

  private async requireOwnWatch(
    user: AuthenticatedUser,
    watchId: string,
  ): Promise<TravelWatchRecord> {
    const watch = await this.repositories.travelWatches.findById(watchId);

    if (!watch || watch.userId !== user.id) {
      throw new AppError('NOT_FOUND', 'No such watch for this user', {
        publicMessage: 'That watch no longer exists.',
      });
    }

    return watch;
  }

  /** High priority is a plan feature; asking for it without it is not an error. */
  private allowedPriority(requested: WatchPriority, entitlements: Entitlements): WatchPriority {
    return requested === 'high' && !entitlements.canPrioritiseWatches ? 'normal' : requested;
  }
}
