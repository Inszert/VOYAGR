import { randomUUID } from 'node:crypto';
import type {
  NotificationRecord,
  NotificationRepository,
  PriceHistoryRepository,
  PriceObservationRecord,
  PushSubscriptionRecord,
  PushSubscriptionRepository,
  Repositories,
  TravelWatchRecord,
  TravelWatchRepository,
  TripSearchRecord,
  TripSearchRepository,
  UserRecord,
  UserRepository,
} from './repository';
import { AppError } from '@/lib/errors';

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

  async create(input: Omit<UserRecord, 'createdAt'>): Promise<UserRecord> {
    if (await this.findByEmail(input.email)) {
      throw new AppError('CONFLICT', `A user already exists with email ${input.email}`, {
        publicMessage: 'An account with that email already exists.',
      });
    }

    const record: UserRecord = { ...input, createdAt: now() };
    this.byId.set(record.id, record);
    return record;
  }
}

class MemoryTripSearchRepository implements TripSearchRepository {
  private readonly byId = new Map<string, TripSearchRecord>();

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
    patch: Partial<Pick<TripSearchRecord, 'name' | 'profile'>>,
  ): Promise<TripSearchRecord> {
    const existing = this.byId.get(id);
    if (!existing) {
      throw new AppError('NOT_FOUND', `Trip search ${id} does not exist`);
    }

    const updated: TripSearchRecord = { ...existing, ...patch, updatedAt: now() };
    this.byId.set(id, updated);
    return updated;
  }
}

class MemoryTravelWatchRepository implements TravelWatchRepository {
  private readonly byId = new Map<string, TravelWatchRecord>();

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
  ): Promise<PriceObservationRecord | null> {
    const candidates = (this.byWatch.get(watchId) ?? []).filter(
      (record) => record.componentType === componentType,
    );

    if (candidates.length === 0) return null;

    return candidates.reduce((lowest, candidate) =>
      candidate.amount.amount < lowest.amount.amount ? candidate : lowest,
    );
  }
}

class MemoryNotificationRepository implements NotificationRepository {
  private readonly byId = new Map<string, NotificationRecord>();

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
}

/** Build a complete, isolated set of in-memory repositories. */
export function createMemoryRepositories(): Repositories {
  return {
    users: new MemoryUserRepository(),
    tripSearches: new MemoryTripSearchRepository(),
    travelWatches: new MemoryTravelWatchRepository(),
    priceHistory: new MemoryPriceHistoryRepository(),
    notifications: new MemoryNotificationRepository(),
    pushSubscriptions: new MemoryPushSubscriptionRepository(),
    backend: 'memory',
  };
}
