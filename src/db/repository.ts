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
  readonly createdAt: IsoDateTime;
}

export interface TripSearchRecord {
  readonly id: string;
  readonly userId: string;
  readonly name: string;
  readonly profile: SearchProfile;
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
  findByEmail(email: string): Promise<UserRecord | null>;
  create(input: Omit<UserRecord, 'createdAt'>): Promise<UserRecord>;
}

export interface TripSearchRepository {
  findById(id: string): Promise<TripSearchRecord | null>;
  listByUser(userId: string): Promise<TripSearchRecord[]>;
  create(input: Omit<TripSearchRecord, 'createdAt' | 'updatedAt'>): Promise<TripSearchRecord>;
  update(
    id: string,
    patch: Partial<Pick<TripSearchRecord, 'name' | 'profile'>>,
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
  /** Cheapest observation recorded for a watch, or null when none exist. */
  findLowest(
    watchId: string,
    componentType: PriceObservationRecord['componentType'],
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
  readonly tripSearches: TripSearchRepository;
  readonly travelWatches: TravelWatchRepository;
  readonly priceHistory: PriceHistoryRepository;
  readonly notifications: NotificationRepository;
  readonly pushSubscriptions: PushSubscriptionRepository;
  /** Identifies the active backend, for diagnostics. */
  readonly backend: 'memory' | 'postgres';
}
