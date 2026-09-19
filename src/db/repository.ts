import type { Money } from '@/core/money';
import type { IsoDateTime, SearchProfile } from '@/core/trip/types';

/**
 * Repository interfaces.
 *
 * The persistence seam. Feature code depends on these interfaces, and an
 * implementation decides whether that means Postgres or an in-memory map. That
 * is what lets the whole foundation run, and its tests pass, with no database.
 *
 * The entities mirror the data model in specification section 21. Only the
 * entities the Phase 1 loop needs are modelled here; the rest arrive with the
 * features that use them.
 */

export interface UserRecord {
  readonly id: string;
  readonly email: string;
  /**
   * The plan this user is on. Entitlements are resolved from it by
   * `src/core/entitlements.ts` and never hard-coded at a call site, so a paid
   * tier later is a new row rather than a rewrite (sections 24.2 and 24.3).
   */
  readonly plan: string;
  readonly createdAt: IsoDateTime;
}

/**
 * A user's password material, kept in its own record.
 *
 * Separate from `UserRecord` on purpose: a user is fetched on every request and
 * handed to feature code, and a password hash has no business travelling with
 * it. Nothing outside `src/auth/` should ever need this repository.
 */
export interface UserCredentialRecord {
  readonly userId: string;
  /** Self-describing hash, including algorithm and parameters. Never logged. */
  readonly passwordHash: string;
  readonly updatedAt: IsoDateTime;
}

/**
 * A server-side session.
 *
 * The cookie carries a token; this stores only its SHA-256. A database leak
 * then yields no usable sessions, which is the whole reason the raw token is
 * not persisted.
 */
export interface SessionRecord {
  readonly id: string;
  readonly userId: string;
  /** SHA-256 of the session token, hex encoded. Never the token itself. */
  readonly tokenHash: string;
  readonly createdAt: IsoDateTime;
  readonly expiresAt: IsoDateTime;
}

/**
 * What a user likes, with explicit and inferred kept apart.
 *
 * Section 31.7 requires the user to be able to see what the system believes
 * about them and why. That is only possible if "you told us this" and "we
 * guessed this" are never mixed into one blob, so they are two fields and it is
 * a schema-level guarantee rather than a convention.
 */
export interface UserPreferencesRecord {
  readonly userId: string;
  /** Set deliberately by the user. Authoritative. */
  readonly explicit: Readonly<Record<string, unknown>>;
  /** Learned from behaviour. Advisory, always overridden by `explicit`. */
  readonly inferred: Readonly<Record<string, unknown>>;
  readonly updatedAt: IsoDateTime;
}

export interface TripSearchRecord {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly profile: SearchProfile;
  /**
   * Where the search looks.
   *
   * A `SearchProfile` says what kind of trip is wanted, not where: destinations
   * live on the request. Without them a saved search cannot be replayed, and a
   * watch that cannot replay its own search is not a watch.
   */
  readonly destinations: readonly string[];
  readonly createdAt: IsoDateTime;
  readonly updatedAt: IsoDateTime;
}

/**
 * A saved search promoted to an active watch (specification section 17).
 * `nextRunAt` drives adaptive polling: the scheduler picks up whatever is due.
 */
export interface TravelWatchRecord {
  readonly id: string;
  readonly userId: string;
  readonly tripSearchId: string;
  readonly status: 'active' | 'paused' | 'archived';
  readonly priority: 'normal' | 'high';
  readonly lastRunAt: IsoDateTime | null;
  readonly nextRunAt: IsoDateTime;
  /** Best total seen so far, for detecting a material improvement. */
  readonly bestKnownTotal: Money | null;
  readonly createdAt: IsoDateTime;
}

/**
 * A single price observation (specification section 22).
 *
 * Source, timestamp and conditions are mandatory, not optional: a price without
 * provenance cannot honestly be shown to a user.
 */
export interface PriceObservationRecord {
  readonly id: string;
  readonly watchId: string;
  readonly componentType: 'flight' | 'hotel' | 'transfer' | 'trip_total';
  readonly componentId: string;
  readonly amount: Money;
  readonly providerId: string;
  readonly observedAt: IsoDateTime;
  readonly conditions: string | null;
}

export interface NotificationRecord {
  readonly id: string;
  readonly userId: string;
  readonly watchId: string | null;
  readonly severity: 'important' | 'interesting' | 'fyi';
  readonly title: string;
  readonly body: string;
  readonly createdAt: IsoDateTime;
  readonly readAt: IsoDateTime | null;
  readonly deliveredAt: IsoDateTime | null;
}

export interface PushSubscriptionRecord {
  readonly id: string;
  readonly userId: string;
  readonly endpoint: string;
  /** Subscription keys. Treated as a secret and never logged. */
  readonly keys: { readonly p256dh: string; readonly auth: string };
  readonly createdAt: IsoDateTime;
}

// --- Repository contracts --------------------------------------------------

export interface UserRepository {
  findById(id: string): Promise<UserRecord | null>;
  /** Case-insensitive: nobody registers twice by capitalising their email. */
  findByEmail(email: string): Promise<UserRecord | null>;
  create(input: Omit<UserRecord, 'createdAt'>): Promise<UserRecord>;
  update(id: string, patch: Partial<Pick<UserRecord, 'plan'>>): Promise<UserRecord>;
}

export interface UserCredentialRepository {
  findByUserId(userId: string): Promise<UserCredentialRecord | null>;
  /** Insert or replace. Replacing is a password change. */
  upsert(userId: string, passwordHash: string): Promise<UserCredentialRecord>;
}

export interface SessionRepository {
  findByTokenHash(tokenHash: string): Promise<SessionRecord | null>;
  create(input: Omit<SessionRecord, 'createdAt'>): Promise<SessionRecord>;
  delete(id: string): Promise<void>;
  /** Every session for a user, for "sign out everywhere" and password changes. */
  deleteForUser(userId: string): Promise<void>;
  /** Housekeeping: drop everything already expired at `now`. */
  deleteExpired(now: IsoDateTime): Promise<number>;
}

export interface UserPreferencesRepository {
  find(userId: string): Promise<UserPreferencesRecord | null>;
  /** Merges into the named side; the other is left untouched. */
  save(
    userId: string,
    patch: { explicit?: Record<string, unknown>; inferred?: Record<string, unknown> },
  ): Promise<UserPreferencesRecord>;
}

export interface TripSearchRepository {
  findById(id: string): Promise<TripSearchRecord | null>;
  listByUser(userId: string): Promise<TripSearchRecord[]>;
  create(input: Omit<TripSearchRecord, 'createdAt' | 'updatedAt'>): Promise<TripSearchRecord>;
  update(
    id: string,
    patch: Partial<Pick<TripSearchRecord, 'name' | 'profile' | 'destinations'>>,
  ): Promise<TripSearchRecord>;
}

export interface TravelWatchRepository {
  findById(id: string): Promise<TravelWatchRecord | null>;
  listByUser(userId: string): Promise<TravelWatchRecord[]>;
  /** Watches due to run, oldest deadline first. Drives the scheduler. */
  listDue(now: IsoDateTime, limit: number): Promise<TravelWatchRecord[]>;
  create(input: Omit<TravelWatchRecord, 'createdAt'>): Promise<TravelWatchRecord>;
  update(
    id: string,
    patch: Partial<
      Pick<TravelWatchRecord, 'status' | 'priority' | 'lastRunAt' | 'nextRunAt' | 'bestKnownTotal'>
    >,
  ): Promise<TravelWatchRecord>;
}

export interface PriceHistoryRepository {
  record(observation: Omit<PriceObservationRecord, 'id'>): Promise<PriceObservationRecord>;
  listForWatch(watchId: string, limit?: number): Promise<PriceObservationRecord[]>;
  /**
   * Cheapest observation recorded for a watch, or null when none exist.
   *
   * `currency` is required, not optional. Comparing minor units across
   * currencies is meaningless - 50000 GBP is not cheaper than 60000 EUR - and
   * `src/core/money.ts` refuses to do it, so a repository method that did it
   * silently would contradict the one rule the whole money model rests on.
   */
  findLowest(
    watchId: string,
    componentType: PriceObservationRecord['componentType'],
    currency: string,
  ): Promise<PriceObservationRecord | null>;
}

export interface NotificationRepository {
  create(input: Omit<NotificationRecord, 'id' | 'createdAt'>): Promise<NotificationRecord>;
  listByUser(userId: string, limit?: number): Promise<NotificationRecord[]>;
  markRead(id: string, readAt: IsoDateTime): Promise<void>;
}

export interface PushSubscriptionRepository {
  listByUser(userId: string): Promise<PushSubscriptionRecord[]>;
  create(input: Omit<PushSubscriptionRecord, 'id' | 'createdAt'>): Promise<PushSubscriptionRecord>;
  deleteByEndpoint(endpoint: string): Promise<void>;
}

/** The complete persistence surface, handed to feature code as one object. */
export interface Repositories {
  readonly users: UserRepository;
  readonly credentials: UserCredentialRepository;
  readonly sessions: SessionRepository;
  readonly preferences: UserPreferencesRepository;
  readonly tripSearches: TripSearchRepository;
  readonly travelWatches: TravelWatchRepository;
  readonly priceHistory: PriceHistoryRepository;
  readonly notifications: NotificationRepository;
  readonly pushSubscriptions: PushSubscriptionRepository;
  /** Identifies the active backend, for diagnostics. */
  readonly backend: 'memory' | 'postgres';
}
