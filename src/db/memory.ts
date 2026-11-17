import { randomUUID } from 'node:crypto';
import type {
  AlertPreferencesInput,
  AlertPreferencesRecord,
  AlertPreferencesRepository,
  EmailChangeRepository,
  EmailChangeTokenRecord,
  EmailVerificationRepository,
  EmailVerificationTokenRecord,
  EmergencyContactRecord,
  EmergencyContactRepository,
  ErasureSummary,
  NotificationRecord,
  NotificationRepository,
  PasswordResetRepository,
  DayStopInput,
  DayStopPlacement,
  DayStopRecord,
  PlanItemInput,
  PlanItemRecord,
  PlanItemRepository,
  PasswordResetTokenRecord,
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
  TripExpenseRecord,
  TripExpenseRepository,
  TripInput,
  TripInviteInput,
  TripInviteRecord,
  TripInviteRepository,
  TripMemberRecord,
  TripRecord,
  TripRepository,
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

  async updateEmail(id: string, newEmail: string): Promise<UserRecord> {
    const existing = this.byId.get(id);
    if (!existing) {
      throw new AppError('NOT_FOUND', `No user with id ${id}`);
    }

    const other = await this.findByEmail(newEmail);
    if (other && other.id !== id) {
      throw new AppError('CONFLICT', `Email already taken: ${newEmail}`, {
        publicMessage: 'An account with that email already exists.',
      });
    }

    const updated: UserRecord = { ...existing, email: newEmail, emailVerifiedAt: null };
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
      passwordResetTokens: 0,
      emailChangeTokens: 0,
      trips: 0,
      emergencyContacts: 0,
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

class MemoryPasswordResetRepository implements PasswordResetRepository {
  private readonly byId = new Map<string, PasswordResetTokenRecord>();

  async findByTokenHash(tokenHash: string): Promise<PasswordResetTokenRecord | null> {
    for (const token of this.byId.values()) {
      if (token.tokenHash === tokenHash) return token;
    }
    return null;
  }

  async create(
    input: Omit<PasswordResetTokenRecord, 'createdAt'>,
  ): Promise<PasswordResetTokenRecord> {
    const record: PasswordResetTokenRecord = { ...input, createdAt: now() };
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

class MemoryEmailChangeRepository implements EmailChangeRepository {
  private readonly byId = new Map<string, EmailChangeTokenRecord>();

  async findByTokenHash(tokenHash: string): Promise<EmailChangeTokenRecord | null> {
    for (const token of this.byId.values()) {
      if (token.tokenHash === tokenHash) return token;
    }
    return null;
  }

  async create(input: Omit<EmailChangeTokenRecord, 'createdAt'>): Promise<EmailChangeTokenRecord> {
    const record: EmailChangeTokenRecord = { ...input, createdAt: now() };
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

class MemoryAlertPreferencesRepository implements AlertPreferencesRepository {
  private readonly byUserId = new Map<string, AlertPreferencesRecord>();

  async find(userId: string): Promise<AlertPreferencesRecord | null> {
    return this.byUserId.get(userId) ?? null;
  }

  async save(userId: string, input: AlertPreferencesInput): Promise<AlertPreferencesRecord> {
    const record: AlertPreferencesRecord = {
      ...input,
      destinations: [...input.destinations],
      userId,
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

  async upsert(
    input: Omit<TripSearchRecord, 'createdAt' | 'updatedAt'>,
  ): Promise<TripSearchRecord> {
    const timestamp = now();
    const existing = this.byId.get(input.id);
    // The owner is part of the key's meaning; never hand a row to another user.
    if (existing && existing.userId !== input.userId) {
      throw new AppError('CONFLICT', `Trip search ${input.id} belongs to another user`);
    }
    const record: TripSearchRecord = {
      ...input,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
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

/** What a trip's own tables do when it goes. Wired in `createMemoryRepositories`. */
type TripCascade = (tripId: string) => void;

class MemoryTripRepository implements TripRepository {
  private readonly trips = new Map<string, TripRecord>();
  private readonly members = new Map<string, TripMemberRecord>();
  cascade: TripCascade | null = null;

  async findById(id: string): Promise<TripRecord | null> {
    return this.trips.get(id) ?? null;
  }

  async listForUser(userId: string): Promise<TripRecord[]> {
    const joined = new Set(
      [...this.members.values()]
        .filter((member) => member.userId === userId)
        .map((member) => member.tripId),
    );
    return [...this.trips.values()]
      .filter((trip) => trip.ownerId === userId || joined.has(trip.id))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  }

  async create(input: TripInput, ownerName: string): Promise<TripRecord> {
    const stamp = now();
    const trip: TripRecord = { ...input, id: randomUUID(), createdAt: stamp, updatedAt: stamp };
    this.trips.set(trip.id, trip);
    const owner: TripMemberRecord = {
      id: randomUUID(),
      tripId: trip.id,
      userId: input.ownerId,
      name: ownerName,
      createdAt: stamp,
    };
    this.members.set(owner.id, owner);
    return trip;
  }

  async update(
    id: string,
    patch: Partial<
      Pick<TripRecord, 'name' | 'destination' | 'destinationCountry' | 'startDate' | 'endDate'>
    >,
  ): Promise<TripRecord> {
    const existing = this.trips.get(id);
    if (!existing) throw new AppError('NOT_FOUND', `No trip with id ${id}`);
    const updated = { ...existing, ...patch, updatedAt: now() };
    this.trips.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    this.removeTrip(id);
  }

  private removeTrip(id: string): void {
    this.trips.delete(id);
    for (const [memberId, member] of this.members) {
      if (member.tripId === id) this.members.delete(memberId);
    }
    this.cascade?.(id);
  }

  async listMembers(tripId: string): Promise<TripMemberRecord[]> {
    return [...this.members.values()]
      .filter((member) => member.tripId === tripId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }

  async addMember(input: Omit<TripMemberRecord, 'id' | 'createdAt'>): Promise<TripMemberRecord> {
    const member: TripMemberRecord = { ...input, id: randomUUID(), createdAt: now() };
    this.members.set(member.id, member);
    return member;
  }

  async removeMember(tripId: string, memberId: string): Promise<void> {
    if (this.members.get(memberId)?.tripId === tripId) this.members.delete(memberId);
  }

  /** The user's trips go; their seat on anyone else's stays, without their name. */
  eraseUser(userId: string): number {
    const owned = [...this.trips.values()].filter((trip) => trip.ownerId === userId);
    for (const trip of owned) this.removeTrip(trip.id);

    for (const [id, member] of this.members) {
      if (member.userId === userId) {
        this.members.set(id, { ...member, userId: null, name: 'Former member' });
      }
    }
    return owned.length;
  }
}

class MemoryTripInviteRepository implements TripInviteRepository {
  private readonly byId = new Map<string, TripInviteRecord>();

  async create(input: TripInviteInput): Promise<TripInviteRecord> {
    const record: TripInviteRecord = {
      ...input,
      id: randomUUID(),
      createdAt: now(),
      revokedAt: null,
      uses: 0,
    };
    this.byId.set(record.id, record);
    return record;
  }

  async findByHash(tokenHash: string): Promise<TripInviteRecord | null> {
    return [...this.byId.values()].find((invite) => invite.tokenHash === tokenHash) ?? null;
  }

  async listActiveByTrip(tripId: string, at: string): Promise<TripInviteRecord[]> {
    return [...this.byId.values()]
      .filter((i) => i.tripId === tripId && i.revokedAt === null && i.expiresAt > at)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  }

  async revoke(tripId: string, at: string, inviteId?: string): Promise<number> {
    let count = 0;
    for (const [id, invite] of this.byId) {
      if (invite.tripId !== tripId || invite.revokedAt !== null) continue;
      if (inviteId !== undefined && id !== inviteId) continue;
      this.byId.set(id, { ...invite, revokedAt: at });
      count += 1;
    }
    return count;
  }

  async claim(id: string, at: string): Promise<boolean> {
    const invite = this.byId.get(id);
    if (!invite || invite.revokedAt !== null || invite.expiresAt <= at) return false;
    if (invite.uses >= invite.maxUses) return false;
    this.byId.set(id, { ...invite, uses: invite.uses + 1 });
    return true;
  }

  eraseTrip(tripId: string): void {
    for (const [id, invite] of this.byId) if (invite.tripId === tripId) this.byId.delete(id);
  }

  eraseCreator(userId: string): void {
    for (const [id, invite] of this.byId) if (invite.createdBy === userId) this.byId.delete(id);
  }
}

class MemoryPlanItemRepository implements PlanItemRepository {
  private readonly byId = new Map<string, PlanItemRecord>();
  /** The day and place in the day of an item that is a day-plan stop. */
  private readonly placement = new Map<string, { day: number; position: number }>();

  async findById(id: string): Promise<PlanItemRecord | null> {
    return this.byId.get(id) ?? null;
  }

  async createStop(input: DayStopInput): Promise<DayStopRecord> {
    const item = await this.create({
      tripId: input.tripId,
      kind: 'activity',
      title: input.title,
      date: null,
      startsAt: null,
      price: null,
      partnerOfferId: null,
      outboundUrl: input.url,
      status: 'idea',
    });
    this.placement.set(item.id, { day: input.day, position: input.position });
    return {
      id: item.id,
      tripId: input.tripId,
      title: input.title,
      url: input.url,
      day: input.day,
      position: input.position,
    };
  }

  async listStops(tripId: string): Promise<DayStopRecord[]> {
    const stops: DayStopRecord[] = [];
    for (const item of this.byId.values()) {
      const place = this.placement.get(item.id);
      if (item.tripId !== tripId || !place) continue;
      stops.push({
        id: item.id,
        tripId,
        title: item.title,
        url: item.outboundUrl,
        day: place.day,
        position: place.position,
      });
    }
    return stops.sort(
      (a, b) => a.day - b.day || a.position - b.position || a.id.localeCompare(b.id),
    );
  }

  async placeStops(tripId: string, placements: readonly DayStopPlacement[]): Promise<void> {
    for (const entry of placements) {
      const item = this.byId.get(entry.id);
      if (!item || item.tripId !== tripId || !this.placement.has(entry.id)) continue;
      this.placement.set(entry.id, { day: entry.day, position: entry.position });
    }
  }

  async listByTrip(tripId: string): Promise<PlanItemRecord[]> {
    return [...this.byId.values()]
      .filter((item) => item.tripId === tripId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }

  async create(input: PlanItemInput): Promise<PlanItemRecord> {
    const stamp = now();
    const item: PlanItemRecord = { ...input, id: randomUUID(), createdAt: stamp, updatedAt: stamp };
    this.byId.set(item.id, item);
    return item;
  }

  async update(id: string, patch: Partial<Omit<PlanItemInput, 'tripId'>>): Promise<PlanItemRecord> {
    const existing = this.byId.get(id);
    if (!existing) throw new AppError('NOT_FOUND', `No plan item with id ${id}`);
    const updated = { ...existing, ...patch, updatedAt: now() };
    this.byId.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    this.byId.delete(id);
    this.placement.delete(id);
  }

  eraseTrip(tripId: string): void {
    for (const [id, item] of this.byId) {
      if (item.tripId === tripId) {
        this.byId.delete(id);
        this.placement.delete(id);
      }
    }
  }
}

class MemoryTripExpenseRepository implements TripExpenseRepository {
  private readonly byId = new Map<string, TripExpenseRecord>();

  async findById(id: string): Promise<TripExpenseRecord | null> {
    return this.byId.get(id) ?? null;
  }

  async listByTrip(tripId: string): Promise<TripExpenseRecord[]> {
    return [...this.byId.values()]
      .filter((expense) => expense.tripId === tripId)
      .sort(
        (a, b) =>
          a.date.localeCompare(b.date) ||
          a.createdAt.localeCompare(b.createdAt) ||
          a.id.localeCompare(b.id),
      );
  }

  async create(input: Omit<TripExpenseRecord, 'id' | 'createdAt'>): Promise<TripExpenseRecord> {
    const record: TripExpenseRecord = { ...input, id: randomUUID(), createdAt: now() };
    this.byId.set(record.id, record);
    return record;
  }

  async update(
    id: string,
    input: Omit<TripExpenseRecord, 'id' | 'tripId' | 'createdAt'>,
  ): Promise<TripExpenseRecord> {
    const existing = this.byId.get(id);
    if (!existing) throw new AppError('NOT_FOUND', `No expense ${id}`);

    const record: TripExpenseRecord = {
      ...input,
      id,
      tripId: existing.tripId,
      createdAt: existing.createdAt,
    };
    this.byId.set(id, record);
    return record;
  }

  async delete(id: string): Promise<void> {
    this.byId.delete(id);
  }

  eraseTrip(tripId: string): void {
    for (const [id, expense] of this.byId) {
      if (expense.tripId === tripId) this.byId.delete(id);
    }
  }
}

class MemoryEmergencyContactRepository implements EmergencyContactRepository {
  private readonly byId = new Map<string, EmergencyContactRecord>();

  async findById(id: string): Promise<EmergencyContactRecord | null> {
    return this.byId.get(id) ?? null;
  }

  async listByUser(userId: string): Promise<EmergencyContactRecord[]> {
    return [...this.byId.values()]
      .filter((contact) => contact.userId === userId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }

  async create(
    input: Omit<EmergencyContactRecord, 'id' | 'createdAt'>,
  ): Promise<EmergencyContactRecord> {
    const record: EmergencyContactRecord = { ...input, id: randomUUID(), createdAt: now() };
    this.byId.set(record.id, record);
    return record;
  }

  async delete(id: string): Promise<void> {
    this.byId.delete(id);
  }

  eraseUser(userId: string): number {
    let removed = 0;
    for (const [id, contact] of this.byId) {
      if (contact.userId === userId) {
        this.byId.delete(id);
        removed += 1;
      }
    }
    return removed;
  }
}

/** Build a complete, isolated set of in-memory repositories. */
export function createMemoryRepositories(): Repositories {
  const users = new MemoryUserRepository();
  const credentials = new MemoryUserCredentialRepository();
  const sessions = new MemorySessionRepository();
  const emailVerification = new MemoryEmailVerificationRepository();
  const passwordReset = new MemoryPasswordResetRepository();
  const emailChange = new MemoryEmailChangeRepository();
  const preferences = new MemoryUserPreferencesRepository();
  const alertPreferences = new MemoryAlertPreferencesRepository();
  const tripSearches = new MemoryTripSearchRepository();
  const travelWatches = new MemoryTravelWatchRepository();
  const priceHistory = new MemoryPriceHistoryRepository();
  const notifications = new MemoryNotificationRepository();
  const pushSubscriptions = new MemoryPushSubscriptionRepository();
  const providerRequests = new MemoryProviderRequestRepository();
  const trips = new MemoryTripRepository();
  const planItems = new MemoryPlanItemRepository();
  const tripInvites = new MemoryTripInviteRepository();
  const tripExpenses = new MemoryTripExpenseRepository();
  const emergencyContacts = new MemoryEmergencyContactRepository();

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

  // A trip takes its plan and its expenses with it.
  trips.cascade = (tripId) => {
    planItems.eraseTrip(tripId);
    tripInvites.eraseTrip(tripId);
    tripExpenses.eraseTrip(tripId);
  };

  users.cascade = (userId) => {
    const watchIds = travelWatches.eraseUser(userId);
    tripInvites.eraseCreator(userId);
    // Not in the summary: it is part of the same preferences the user set, and Postgres
    // removes it by cascade without counting it.
    alertPreferences.eraseUser(userId);

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
      passwordResetTokens: passwordReset.eraseUser(userId),
      emailChangeTokens: emailChange.eraseUser(userId),
      trips: trips.eraseUser(userId),
      emergencyContacts: emergencyContacts.eraseUser(userId),
    };
  };

  return {
    users,
    credentials,
    sessions,
    emailVerification,
    passwordReset,
    emailChange,
    preferences,
    alertPreferences,
    tripSearches,
    travelWatches,
    priceHistory,
    notifications,
    pushSubscriptions,
    providerRequests,
    trips,
    tripInvites,
    planItems,
    tripExpenses,
    emergencyContacts,
    backend: 'memory',
  };
}
