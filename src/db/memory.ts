import { randomUUID } from 'node:crypto';
import type {
  EmailVerificationRepository,
  EmailVerificationTokenRecord,
  ErasureSummary,
  NotificationRecord,
  NotificationRepository,
  PriceHistoryRepository,
  PriceObservationRecord,
  ProviderCallSummary,
  ProviderRequestRecord,
  ProviderRequestRepository,
  PushSubscriptionRecord,
  PushSubscriptionRepository,
  Repositories,
  SessionRecord,
  SessionRepository,
  TravelWatchRecord,
  TravelWatchRepository,
  TripSearchRecord,
  TripSearchRepository,
  UserCredentialRecord,
  UserCredentialRepository,
  UserPreferencesRecord,
  UserPreferencesRepository,
  UserRecord,
  UserRepository,
} from './repository';
import { AppError } from '@/lib/errors';
import { summariseProviderCalls } from '@/providers/observability';

/**
 * In-memory repository implementation.
 *
 * The default backend when `DATABASE_URL` is unset. It makes the entire
 * application runnable and testable with no external services, which is exactly
 * what the bootstrap needs: Postgres arrives when persistence is implemented,
 * not before.
 *
 * Data lives for the life of the process. This is a development and test
 * backend; it is never a production one.
 */

function now(): string {
  return new Date().toISOString();
}

class MemoryUserRepository implements UserRepository {
  private readonly byId = new Map<string, UserRecord>();

  async findById(id: string): Promise<UserRecord | null> {
    return this.byId.get(id) ?? null;
  }

  async findByEmail(email: string): Promise<UserRecord | null> {
    const normalised = email.toLowerCase();
    for (const user of this.byId.values()) {
      if (user.email.toLowerCase() === normalised) return user;
    }
    return null;
  }

  async create(input: Omit<UserRecord, 'createdAt' | 'emailVerifiedAt'>): Promise<UserRecord> {
    if (await this.findByEmail(input.email)) {
      throw new AppError('CONFLICT', `A user already exists with email ${input.email}`, {
        publicMessage: 'An account with that email already exists.',
      });
    }

    const record: UserRecord = { ...input, createdAt: now(), emailVerifiedAt: null };
    this.byId.set(record.id, record);
    return record;
  }

  async update(
    id: string,
    patch: Partial<Pick<UserRecord, 'plan' | 'emailVerifiedAt'>>,
  ): Promise<UserRecord> {
    const existing = this.byId.get(id);
    if (!existing) {
      throw new AppError('NOT_FOUND', `No user with id ${id}`);
    }

    const updated: UserRecord = { ...existing, ...patch };
    this.byId.set(id, updated);
    return updated;
  }
  /**
   * What else to remove, supplied by the factory.
   *
   * The user store cannot reach its siblings, and an erasure that only
   * removes the user row leaves working sessions and running watches behind
   * - so the factory wires this, and `erase` is the only entry point.
   */
  cascade: ((userId: string) => Omit<ErasureSummary, 'userExisted'>) | null = null;

  async erase(id: string): Promise<ErasureSummary> {
    const userExisted = this.byId.delete(id);

    const removed = this.cascade?.(id) ?? {
      sessions: 0,
      savedSearches: 0,
      travelWatches: 0,
      priceObservations: 0,
      notifications: 0,
      pushSubscriptions: 0,
      preferences: 0,
      credentials: 0,
      emailVerificationTokens: 0,
    };

    return { userExisted, ...removed };
  }
}

class MemoryUserCredentialRepository implements UserCredentialRepository {
  private readonly byUserId = new Map<string, UserCredentialRecord>();

  async findByUserId(userId: string): Promise<UserCredentialRecord | null> {
    return this.byUserId.get(userId) ?? null;
  }

  async upsert(userId: string, passwordHash: string): Promise<UserCredentialRecord> {
    const record: UserCredentialRecord = { userId, passwordHash, updatedAt: now() };
    this.byUserId.set(userId, record);
    return record;
  }
  eraseUser(userId: string): number {
    return this.byUserId.delete(userId) ? 1 : 0;
  }
}

class MemorySessionRepository implements SessionRepository {
  private readonly byId = new Map<string, SessionRecord>();

  async findByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    for (const session of this.byId.values()) {
      if (session.tokenHash === tokenHash) return session;
    }
    return null;
  }

  async create(input: Omit<SessionRecord, 'createdAt'>): Promise<SessionRecord> {
    const record: SessionRecord = { ...input, createdAt: now() };
    this.byId.set(record.id, record);
    return record;
  }

  async delete(id: string): Promise<void> {
    this.byId.delete(id);
  }

  async deleteForUser(userId: string): Promise<void> {
    for (const [id, session] of this.byId) {
      if (session.userId === userId) this.byId.delete(id);
    }
  }

  async deleteExpired(nowIso: string): Promise<number> {
    let removed = 0;
    for (const [id, session] of this.byId) {
      if (session.expiresAt <= nowIso) {
        this.byId.delete(id);
        removed += 1;
      }
    }
    return removed;
  }
  eraseUser(userId: string): number {
    let removed = 0;
    for (const [id, record] of this.byId) {
      if (record.userId === userId) {
        this.byId.delete(id);
        removed += 1;
      }
    }
    return removed;
  }
}

class MemoryEmailVerificationRepository implements EmailVerificationRepository {
  private readonly byId = new Map<string, EmailVerificationTokenRecord>();

  async findByTokenHash(tokenHash: string): Promise<EmailVerificationTokenRecord | null> {
    for (const token of this.byId.values()) {
      if (token.tokenHash === tokenHash) return token;
    }
    return null;
  }

  async create(
    input: Omit<EmailVerificationTokenRecord, 'createdAt'>,
  ): Promise<EmailVerificationTokenRecord> {
    const record: EmailVerificationTokenRecord = { ...input, createdAt: now() };
    this.byId.set(record.id, record);
    return record;
  }

  async delete(id: string): Promise<void> {
    this.byId.delete(id);
  }

  async deleteForUser(userId: string): Promise<void> {
    for (const [id, token] of this.byId) {
      if (token.userId === userId) this.byId.delete(id);
    }
  }

  async deleteExpired(nowIso: string): Promise<number> {
    let removed = 0;
    for (const [id, token] of this.byId) {
      if (token.expiresAt <= nowIso) {
        this.byId.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  eraseUser(userId: string): number {
    let removed = 0;
    for (const [id, token] of this.byId) {
      if (token.userId === userId) {
        this.byId.delete(id);
        removed += 1;
      }
    }
    return removed;
  }
}

class MemoryUserPreferencesRepository implements UserPreferencesRepository {
  private readonly byUserId = new Map<string, UserPreferencesRecord>();

  async find(userId: string): Promise<UserPreferencesRecord | null> {
    return this.byUserId.get(userId) ?? null;
  }

  async save(
    userId: string,
    patch: { explicit?: Record<string, unknown>; inferred?: Record<string, unknown> },
  ): Promise<UserPreferencesRecord> {
    const existing = this.byUserId.get(userId);

    // Each side merges independently. Saving a preference the user set must
    // never quietly discard what the system inferred, or the reverse.
    const record: UserPreferencesRecord = {
      userId,
      explicit: { ...(existing?.explicit ?? {}), ...(patch.explicit ?? {}) },
      inferred: { ...(existing?.inferred ?? {}), ...(patch.inferred ?? {}) },
      updatedAt: now(),
    };

    this.byUserId.set(userId, record);
    return record;
  }
  eraseUser(userId: string): number {
    return this.byUserId.delete(userId) ? 1 : 0;
  }
}

class MemoryTripSearchRepository implements TripSearchRepository {
  private readonly byId = new Map<string, TripSearchRecord>();

  /** What else goes with a search. Wired in `createMemoryRepositories`. */
  cascade: (searchId: string) => void = () => {};

  async delete(id: string): Promise<void> {
    if (!this.byId.delete(id)) return;
    this.cascade(id);
  }

  async findById(id: string): Promise<TripSearchRecord | null> {
    return this.byId.get(id) ?? null;
  }

  async listByUser(userId: string): Promise<TripSearchRecord[]> {
    return [...this.byId.values()]
      .filter((record) => record.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async create(
    input: Omit<TripSearchRecord, 'createdAt' | 'updatedAt'>,
  ): Promise<TripSearchRecord> {
    const timestamp = now();
    const record: TripSearchRecord = { ...input, createdAt: timestamp, updatedAt: timestamp };
    this.byId.set(record.id, record);
    return record;
  }

  async update(
    id: string,
    patch: Partial<Pick<TripSearchRecord, 'name' | 'profile' | 'destinations'>>,
  ): Promise<TripSearchRecord> {
    const existing = this.byId.get(id);
    if (!existing) {
      throw new AppError('NOT_FOUND', `Trip search ${id} does not exist`);
    }

    const updated: TripSearchRecord = { ...existing, ...patch, updatedAt: now() };
    this.byId.set(id, updated);
    return updated;
  }
  eraseUser(userId: string): number {
    let removed = 0;
    for (const [id, record] of this.byId) {
      if (record.userId === userId) {
        this.byId.delete(id);
        removed += 1;
      }
    }
    return removed;
  }
}

class MemoryTravelWatchRepository implements TravelWatchRepository {
  private readonly byId = new Map<string, TravelWatchRecord>();

  /** Drop the watches on one saved search, returning their ids. */
  eraseSearch(searchId: string): string[] {
    const removed: string[] = [];
    for (const [id, record] of this.byId) {
      if (record.tripSearchId === searchId) {
        this.byId.delete(id);
        removed.push(id);
      }
    }
    return removed;
  }

  async findById(id: string): Promise<TravelWatchRecord | null> {
    return this.byId.get(id) ?? null;
  }

  async listByUser(userId: string): Promise<TravelWatchRecord[]> {
    return [...this.byId.values()].filter((record) => record.userId === userId);
  }

  async listDue(nowIso: string, limit: number): Promise<TravelWatchRecord[]> {
    return [...this.byId.values()]
      .filter((record) => record.status === 'active' && record.nextRunAt <= nowIso)
      .sort((a, b) => a.nextRunAt.localeCompare(b.nextRunAt))
      .slice(0, limit);
  }

  async create(input: Omit<TravelWatchRecord, 'createdAt'>): Promise<TravelWatchRecord> {
    const record: TravelWatchRecord = { ...input, createdAt: now() };
    this.byId.set(record.id, record);
    return record;
  }

  async update(
    id: string,
    patch: Partial<
      Pick<TravelWatchRecord, 'status' | 'priority' | 'lastRunAt' | 'nextRunAt' | 'bestKnownTotal'>
    >,
  ): Promise<TravelWatchRecord> {
    const existing = this.byId.get(id);
    if (!existing) {
      throw new AppError('NOT_FOUND', `Travel watch ${id} does not exist`);
    }

    const updated: TravelWatchRecord = { ...existing, ...patch };
    this.byId.set(id, updated);
    return updated;
  }
  eraseUser(userId: string): string[] {
    const removed: string[] = [];

    for (const [id, record] of this.byId) {
      if (record.userId === userId) {
        this.byId.delete(id);
        removed.push(id);
      }
    }

    return removed;
  }
}

class MemoryPriceHistoryRepository implements PriceHistoryRepository {
  private readonly byWatch = new Map<string, PriceObservationRecord[]>();

  async record(observation: Omit<PriceObservationRecord, 'id'>): Promise<PriceObservationRecord> {
    const record: PriceObservationRecord = { ...observation, id: randomUUID() };
    const existing = this.byWatch.get(record.watchId);

    if (existing) existing.push(record);
    else this.byWatch.set(record.watchId, [record]);

    return record;
  }

  async listForWatch(watchId: string, limit = 100): Promise<PriceObservationRecord[]> {
    return [...(this.byWatch.get(watchId) ?? [])]
      .sort((a, b) => b.observedAt.localeCompare(a.observedAt))
      .slice(0, limit);
  }

  async findLowest(
    watchId: string,
    componentType: PriceObservationRecord['componentType'],
    currency: string,
  ): Promise<PriceObservationRecord | null> {
    const candidates = (this.byWatch.get(watchId) ?? []).filter(
      (record) => record.componentType === componentType && record.amount.currency === currency,
    );

    if (candidates.length === 0) return null;

    // Strictly cheaper wins, so an equal price leaves the earlier observation
    // in place: "it has been this cheap since Tuesday" is the honest answer.
    return candidates.reduce((lowest, candidate) =>
      candidate.amount.amount < lowest.amount.amount ? candidate : lowest,
    );
  }

  async pruneOlderThan(before: string): Promise<number> {
    let removed = 0;

    for (const [watchId, records] of this.byWatch) {
      // The cheapest per component and currency survives whatever its age.
      // Dropping it would raise the watch's best-known total and invent a
      // price rise the user never experienced.
      const cheapest = new Map<string, PriceObservationRecord>();

      for (const record of records) {
        const key = `${record.componentType}|${record.amount.currency}`;
        const incumbent = cheapest.get(key);

        if (!incumbent || record.amount.amount < incumbent.amount.amount) {
          cheapest.set(key, record);
        }
      }

      const keep = new Set([...cheapest.values()].map((record) => record.id));
      const surviving = records.filter(
        (record) => keep.has(record.id) || record.observedAt >= before,
      );

      removed += records.length - surviving.length;
      this.byWatch.set(watchId, surviving);
    }

    return removed;
  }
  eraseWatches(watchIds: readonly string[]): number {
    let removed = 0;

    for (const id of watchIds) {
      removed += this.byWatch.get(id)?.length ?? 0;
      this.byWatch.delete(id);
    }

    return removed;
  }
}

class MemoryNotificationRepository implements NotificationRepository {
  private readonly byId = new Map<string, NotificationRecord>();

  async findById(id: string): Promise<NotificationRecord | null> {
    return this.byId.get(id) ?? null;
  }

  async create(input: Omit<NotificationRecord, 'id' | 'createdAt'>): Promise<NotificationRecord> {
    const record: NotificationRecord = { ...input, id: randomUUID(), createdAt: now() };
    this.byId.set(record.id, record);
    return record;
  }

  async listByUser(userId: string, limit = 50): Promise<NotificationRecord[]> {
    return [...this.byId.values()]
      .filter((record) => record.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  async markRead(id: string, readAt: string): Promise<void> {
    const existing = this.byId.get(id);
    if (!existing) return;
    this.byId.set(id, { ...existing, readAt });
  }

  async markDelivered(id: string, deliveredAt: string): Promise<void> {
    const existing = this.byId.get(id);
    if (!existing) return;
    this.byId.set(id, { ...existing, deliveredAt });
  }
  eraseUser(userId: string): number {
    let removed = 0;
    for (const [id, record] of this.byId) {
      if (record.userId === userId) {
        this.byId.delete(id);
        removed += 1;
      }
    }
    return removed;
  }
}

class MemoryPushSubscriptionRepository implements PushSubscriptionRepository {
  private readonly byId = new Map<string, PushSubscriptionRecord>();

  async listByUser(userId: string): Promise<PushSubscriptionRecord[]> {
    return [...this.byId.values()].filter((record) => record.userId === userId);
  }

  async create(
    input: Omit<PushSubscriptionRecord, 'id' | 'createdAt'>,
  ): Promise<PushSubscriptionRecord> {
    // An endpoint is unique per browser install; re-subscribing replaces.
    for (const [id, record] of this.byId) {
      if (record.endpoint === input.endpoint) this.byId.delete(id);
    }

    const record: PushSubscriptionRecord = { ...input, id: randomUUID(), createdAt: now() };
    this.byId.set(record.id, record);
    return record;
  }

  async deleteByEndpoint(endpoint: string): Promise<void> {
    for (const [id, record] of this.byId) {
      if (record.endpoint === endpoint) this.byId.delete(id);
    }
  }
  eraseUser(userId: string): number {
    let removed = 0;
    for (const [id, record] of this.byId) {
      if (record.userId === userId) {
        this.byId.delete(id);
        removed += 1;
      }
    }
    return removed;
  }
}

class MemoryProviderRequestRepository implements ProviderRequestRepository {
  private rows: ProviderRequestRecord[] = [];

  async record(entry: Omit<ProviderRequestRecord, 'createdAt'>): Promise<void> {
    this.rows.push({ ...entry, createdAt: now() });
  }

  async summarise(since: string): Promise<ProviderCallSummary[]> {
    return summariseProviderCalls(this.rows.filter((row) => row.createdAt >= since));
  }

  async deleteBefore(before: string): Promise<number> {
    const kept = this.rows.filter((row) => row.createdAt >= before);
    const removed = this.rows.length - kept.length;
    this.rows = kept;
    return removed;
  }
}

/** Build a complete, isolated set of in-memory repositories. */
export function createMemoryRepositories(): Repositories {
  const users = new MemoryUserRepository();
  const credentials = new MemoryUserCredentialRepository();
  const sessions = new MemorySessionRepository();
  const emailVerification = new MemoryEmailVerificationRepository();
  const preferences = new MemoryUserPreferencesRepository();
  const tripSearches = new MemoryTripSearchRepository();
  const travelWatches = new MemoryTravelWatchRepository();
  const priceHistory = new MemoryPriceHistoryRepository();
  const notifications = new MemoryNotificationRepository();
  const pushSubscriptions = new MemoryPushSubscriptionRepository();
  const providerRequests = new MemoryProviderRequestRepository();

  /*
   * The cascade, in dependence order.
   *
   * Watches are collected before they are dropped, because the observations
   * hang off watch ids and there is no way back to them once the watches are
   * gone. Synchronous on purpose: nothing here awaits, so nothing can
   * interleave and leave the erasure half-done.
   */
  // A saved search takes its watch and that watch's observations with it,
  // as `ON DELETE CASCADE` does in Postgres.
  tripSearches.cascade = (searchId) => {
    priceHistory.eraseWatches(travelWatches.eraseSearch(searchId));
  };

  users.cascade = (userId) => {
    const watchIds = travelWatches.eraseUser(userId);

    return {
      priceObservations: priceHistory.eraseWatches(watchIds),
      travelWatches: watchIds.length,
      sessions: sessions.eraseUser(userId),
      savedSearches: tripSearches.eraseUser(userId),
      notifications: notifications.eraseUser(userId),
      pushSubscriptions: pushSubscriptions.eraseUser(userId),
      preferences: preferences.eraseUser(userId),
      credentials: credentials.eraseUser(userId),
      emailVerificationTokens: emailVerification.eraseUser(userId),
    };
  };

  return {
    users,
    credentials,
    sessions,
    emailVerification,
    preferences,
    tripSearches,
    travelWatches,
    priceHistory,
    notifications,
    pushSubscriptions,
    providerRequests,
    backend: 'memory',
  };
}
