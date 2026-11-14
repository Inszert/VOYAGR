import type { Money } from '@/core/money';
import type { IsoDate, IsoDateTime, SearchProfile } from '@/core/trip/types';

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
  /**
   * When this address was last confirmed reachable, or `null` if never.
   *
   * Does not gate sign-in or search - see `AuthService.register` - so this is
   * a fact to display and act on (a banner, a resend prompt), never a check
   * anything in `src/core/` or the search path reads.
   */
  readonly emailVerifiedAt: IsoDateTime | null;
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
 * An email verification token.
 *
 * Same shape as `SessionRecord` and the same reason: the link in the email
 * carries the raw token, this stores only its SHA-256, and a one-time use is
 * enforced by deleting the row once it has been consumed - see
 * `AuthService.verifyEmail`.
 */
export interface EmailVerificationTokenRecord {
  readonly id: string;
  readonly userId: string;
  readonly tokenHash: string;
  readonly createdAt: IsoDateTime;
  readonly expiresAt: IsoDateTime;
}

/**
 * A password reset token. Same shape and the same reason as
 * `EmailVerificationTokenRecord` - see `AuthService.resetPassword`.
 */
export interface PasswordResetTokenRecord {
  readonly id: string;
  readonly userId: string;
  readonly tokenHash: string;
  readonly createdAt: IsoDateTime;
  readonly expiresAt: IsoDateTime;
}

/**
 * A pending email change. `users.email` is not touched until this is
 * confirmed - see `AuthService.confirmEmailChange` - which is what
 * `newEmail` is for: the address being moved to, not yet the account's own.
 */
export interface EmailChangeTokenRecord {
  readonly id: string;
  readonly userId: string;
  readonly newEmail: string;
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

/**
 * Which price-drop alerts a user wants, and about where.
 *
 * Its own record rather than a key in `UserPreferencesRecord.explicit`: these
 * are read on every watch refresh by the alert filter, and a typed row keeps
 * the budget as integer minor units instead of a number inside JSON.
 *
 * A row that does not exist means "no filter, alerts on" - the behaviour before
 * this record existed - so nobody loses an alert by never opening the form.
 */
export interface AlertPreferencesRecord {
  readonly userId: string;
  /** IATA code of the airport the user flies from, or null when not chosen. */
  readonly homeAirport: string | null;
  /** IATA codes alerts are limited to. Empty means anywhere. */
  readonly destinations: readonly string[];
  /** The most the user wants an alerted trip to cost, or null for no limit. */
  readonly budget: Money | null;
  /** The departure window of interest, either end open. Inclusive. */
  readonly earliestDeparture: IsoDate | null;
  readonly latestDeparture: IsoDate | null;
  readonly priceDropAlerts: boolean;
  readonly updatedAt: IsoDateTime;
}

export type AlertPreferencesInput = Omit<AlertPreferencesRecord, 'userId' | 'updatedAt'>;

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
  /**
   * Where tapping this alert lands, relative to the app origin.
   *
   * Decided when the alert is written, from the search that found the deal,
   * rather than rebuilt at delivery time from state that may have moved on.
   */
  readonly url: string | null;
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
  /**
   * Every new account starts unverified - `emailVerifiedAt` is not a
   * constructor input, so there is no call site to get that wrong.
   */
  create(input: Omit<UserRecord, 'createdAt' | 'emailVerifiedAt'>): Promise<UserRecord>;
  update(
    id: string,
    patch: Partial<Pick<UserRecord, 'plan' | 'emailVerifiedAt'>>,
  ): Promise<UserRecord>;
  /**
   * Change the account's email address.
   *
   * Its own method rather than a case inside `update()`: this is the one
   * field `update()`'s simple COALESCE pattern cannot handle safely, because
   * it has a uniqueness constraint another account could already hold - see
   * `users_email_lower_idx`. Re-verifies that address is still free at the
   * moment of the swap, not only when the change was first requested, since
   * `AuthService.confirmEmailChange` may run long after that.
   *
   * Setting `emailVerifiedAt` back to `null` here, rather than leaving the
   * old value, is deliberate: "this address is confirmed reachable" was a
   * claim about the *old* address, which is no longer the one on the
   * account.
   *
   * @throws AppError CONFLICT when another account already holds that email.
   */
  updateEmail(id: string, newEmail: string): Promise<UserRecord>;
  /**
   * Erase one account and everything personally attached to it.
   *
   * One method rather than a sequence the caller assembles, because an
   * erasure that half-succeeds is worse than one that fails: a user told
   * their account is gone, whose Travel Watches are still running and still
   * emailing them, has been lied to. The implementation is responsible for
   * doing it atomically - a transaction in Postgres, a single synchronous
   * pass in memory.
   *
   * Returns what was removed, so the caller can report it and a test can
   * assert it. Erasing an account that does not exist is not an error: it is
   * the state the caller asked for.
   */
  erase(id: string): Promise<ErasureSummary>;
}

/** What an erasure actually removed. Counts, never contents. */
export interface ErasureSummary {
  readonly userExisted: boolean;
  readonly sessions: number;
  readonly savedSearches: number;
  readonly travelWatches: number;
  readonly priceObservations: number;
  readonly notifications: number;
  readonly pushSubscriptions: number;
  readonly preferences: number;
  readonly credentials: number;
  readonly emailVerificationTokens: number;
  readonly passwordResetTokens: number;
  readonly emailChangeTokens: number;
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

export interface EmailVerificationRepository {
  findByTokenHash(tokenHash: string): Promise<EmailVerificationTokenRecord | null>;
  create(
    input: Omit<EmailVerificationTokenRecord, 'createdAt'>,
  ): Promise<EmailVerificationTokenRecord>;
  delete(id: string): Promise<void>;
  /** Resending a verification email replaces whatever tokens came before it. */
  deleteForUser(userId: string): Promise<void>;
  /** Housekeeping: drop everything already expired at `now`. */
  deleteExpired(now: IsoDateTime): Promise<number>;
}

export interface PasswordResetRepository {
  findByTokenHash(tokenHash: string): Promise<PasswordResetTokenRecord | null>;
  create(input: Omit<PasswordResetTokenRecord, 'createdAt'>): Promise<PasswordResetTokenRecord>;
  delete(id: string): Promise<void>;
  /** Requesting a new reset link replaces whatever tokens came before it. */
  deleteForUser(userId: string): Promise<void>;
  /** Housekeeping: drop everything already expired at `now`. */
  deleteExpired(now: IsoDateTime): Promise<number>;
}

export interface EmailChangeRepository {
  findByTokenHash(tokenHash: string): Promise<EmailChangeTokenRecord | null>;
  create(input: Omit<EmailChangeTokenRecord, 'createdAt'>): Promise<EmailChangeTokenRecord>;
  delete(id: string): Promise<void>;
  /** Requesting a new change replaces whatever tokens came before it. */
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

export interface AlertPreferencesRepository {
  find(userId: string): Promise<AlertPreferencesRecord | null>;
  save(userId: string, input: AlertPreferencesInput): Promise<AlertPreferencesRecord>;
}

export interface TripSearchRepository {
  findById(id: string): Promise<TripSearchRecord | null>;
  listByUser(userId: string): Promise<TripSearchRecord[]>;
  create(input: Omit<TripSearchRecord, 'createdAt' | 'updatedAt'>): Promise<TripSearchRecord>;
  update(
    id: string,
    patch: Partial<Pick<TripSearchRecord, 'name' | 'profile' | 'destinations'>>,
  ): Promise<TripSearchRecord>;
  /**
   * Remove a saved search, and with it the watch on it and everything that
   * watch recorded. Deleting something that is already gone is not an error.
   */
  delete(id: string): Promise<void>;
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
  /**
   * Delete observations recorded before `before`, and report how many went.
   *
   * The cheapest observation ever recorded for each watch, component and
   * currency is always kept, however old it is. Without that exception,
   * pruning would raise every watch's best-known total and invent a price rise
   * the user never experienced - `bestKnownTotal` is derived from this table.
   */
  pruneOlderThan(before: IsoDateTime): Promise<number>;
}

export interface NotificationRepository {
  findById(id: string): Promise<NotificationRecord | null>;
  create(input: Omit<NotificationRecord, 'id' | 'createdAt'>): Promise<NotificationRecord>;
  listByUser(userId: string, limit?: number): Promise<NotificationRecord[]>;
  markRead(id: string, readAt: IsoDateTime): Promise<void>;
  /**
   * Stamped only when something was genuinely sent, so "we told you" is a claim
   * backed by an actual delivery rather than by an attempt.
   */
  markDelivered(id: string, deliveredAt: IsoDateTime): Promise<void>;
}

export interface PushSubscriptionRepository {
  listByUser(userId: string): Promise<PushSubscriptionRecord[]>;
  create(input: Omit<PushSubscriptionRecord, 'id' | 'createdAt'>): Promise<PushSubscriptionRecord>;
  deleteByEndpoint(endpoint: string): Promise<void>;
}

/** The complete persistence surface, handed to feature code as one object. */
/** How one provider call ended, as the `provider_requests` table records it. */
export type ProviderCallStatus = 'ok' | 'error' | 'timeout' | 'rate_limited';

export interface ProviderRequestRecord {
  readonly providerId: string;
  readonly kind: string;
  readonly status: ProviderCallStatus;
  readonly durationMs: number;
  /** Offers on the page it returned, or null when it returned none. */
  readonly resultCount: number | null;
  readonly createdAt: IsoDateTime;
}

/**
 * One provider's calls over a window, summarised.
 *
 * Enough to tell a degraded search from a broken one without reading logs:
 * how many calls, how many failed and how, and how long they took. The
 * percentiles are nearest-rank over the window's durations - the same method
 * in both backends, so the figure does not depend on where it was stored.
 */
export interface ProviderCallSummary {
  readonly providerId: string;
  readonly kind: string;
  readonly calls: number;
  readonly errors: number;
  readonly timeouts: number;
  readonly rateLimited: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
}

export interface ProviderRequestRepository {
  record(entry: Omit<ProviderRequestRecord, 'createdAt'>): Promise<void>;
  /** Every provider called since `since`, busiest first. */
  summarise(since: IsoDateTime): Promise<ProviderCallSummary[]>;
  /** Drop calls recorded before `before`, reporting how many went. */
  deleteBefore(before: IsoDateTime): Promise<number>;
}

export interface Repositories {
  readonly users: UserRepository;
  readonly credentials: UserCredentialRepository;
  readonly sessions: SessionRepository;
  readonly emailVerification: EmailVerificationRepository;
  readonly passwordReset: PasswordResetRepository;
  readonly emailChange: EmailChangeRepository;
  readonly preferences: UserPreferencesRepository;
  readonly alertPreferences: AlertPreferencesRepository;
  readonly tripSearches: TripSearchRepository;
  readonly travelWatches: TravelWatchRepository;
  readonly priceHistory: PriceHistoryRepository;
  readonly notifications: NotificationRepository;
  readonly pushSubscriptions: PushSubscriptionRepository;
  readonly providerRequests: ProviderRequestRepository;
  /** Identifies the active backend, for diagnostics. */
  readonly backend: 'memory' | 'postgres';
}
