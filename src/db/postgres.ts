import { money, type Money } from '@/core/money';
import { AppError } from '@/lib/errors';
import { query, withTransaction } from './client';
import type { SearchProfile } from '@/core/trip/types';
import type {
  EmailVerificationRepository,
  EmailVerificationTokenRecord,
  ErasureSummary,
  NotificationRecord,
  NotificationRepository,
  PasswordResetRepository,
  PasswordResetTokenRecord,
  PriceHistoryRepository,
  PriceObservationRecord,
  PushSubscriptionRecord,
  PushSubscriptionRepository,
  ProviderCallSummary,
  ProviderRequestRecord,
  ProviderRequestRepository,
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
import type { IsoDateTime } from '@/core/trip/types';

/**
 * PostgreSQL repository implementation.
 *
 * The same contract as `memory.ts`, backed by the schema in `migrations/`. Both
 * are held to one shared test suite, because two implementations of an
 * interface that are only ever tested separately are two different interfaces
 * wearing one name.
 *
 * Conventions this file keeps in one place:
 *  - Every statement is parameterised. String interpolation into SQL never
 *    appears in this codebase, not even for a column name.
 *  - Money is a BIGINT of minor units plus an ISO 4217 code. `pg` returns
 *    BIGINT as a string to avoid losing precision, so every amount is parsed
 *    rather than assumed to be a number.
 *  - Timestamps cross the boundary as ISO strings, because that is what the
 *    domain types say they are.
 */

/** `pg` hands back BIGINT as a string; anything else here is worth seeing. */
function toMoney(amount: string | number | null, currency: string | null): Money | null {
  if (amount === null || currency === null) return null;

  const minorUnits = typeof amount === 'string' ? Number.parseInt(amount, 10) : amount;
  if (!Number.isSafeInteger(minorUnits)) {
    throw new AppError('INTERNAL_ERROR', 'Money value from the database is not a safe integer', {
      context: { amount },
    });
  }

  return money(minorUnits, currency);
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toIsoOrNull(value: Date | string | null): string | null {
  return value === null ? null : toIso(value);
}

/** Used wherever a row must exist, so the failure reads the same everywhere. */
function requireRow<T>(row: T | undefined, entity: string, id: string): T {
  if (!row) {
    throw new AppError('NOT_FOUND', `No ${entity} with id ${id}`, {
      publicMessage: 'That item no longer exists.',
    });
  }
  return row;
}

// --- Users -----------------------------------------------------------------

interface UserRow {
  id: string;
  email: string;
  plan: string;
  created_at: Date;
  email_verified_at: Date | null;
}

function toUser(row: UserRow): UserRecord {
  return {
    id: row.id,
    email: row.email,
    plan: row.plan,
    createdAt: toIso(row.created_at),
    emailVerifiedAt: row.email_verified_at ? toIso(row.email_verified_at) : null,
  };
}

const USER_COLUMNS = 'id, email, plan, created_at, email_verified_at';

class PostgresUserRepository implements UserRepository {
  async findById(id: string): Promise<UserRecord | null> {
    const rows = await query<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [id]);
    return rows[0] ? toUser(rows[0]) : null;
  }

  async findByEmail(email: string): Promise<UserRecord | null> {
    // Matches `users_email_lower_idx`, so the lookup uses the index rather
    // than scanning the table.
    const rows = await query<UserRow>(
      `SELECT ${USER_COLUMNS} FROM users WHERE lower(email) = lower($1)`,
      [email],
    );
    return rows[0] ? toUser(rows[0]) : null;
  }

  async create(input: Omit<UserRecord, 'createdAt' | 'emailVerifiedAt'>): Promise<UserRecord> {
    // ON CONFLICT rather than check-then-insert: two simultaneous sign-ups for
    // one address would both pass a check, and the loser would fail on the
    // constraint with an error nobody wrote a message for.
    const rows = await query<UserRow>(
      `INSERT INTO users (id, email, plan)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING
       RETURNING ${USER_COLUMNS}`,
      [input.id, input.email, input.plan],
    );

    if (!rows[0]) {
      throw new AppError('CONFLICT', `A user already exists with email ${input.email}`, {
        publicMessage: 'An account with that email already exists.',
      });
    }

    return toUser(rows[0]);
  }

  async update(
    id: string,
    patch: Partial<Pick<UserRecord, 'plan' | 'emailVerifiedAt'>>,
  ): Promise<UserRecord> {
    // COALESCE lets one statement serve a partial patch, rather than building
    // SQL from whichever keys happen to be present. Never used to clear
    // emailVerifiedAt back to null - nothing in this codebase does that - so
    // COALESCE's "null means leave it alone" is the right behaviour here, not
    // the footgun it would be for a field a caller might legitimately want to
    // null out (see bestKnownTotal on travel watches, which needs the
    // explicit-flag pattern this does not).
    const rows = await query<UserRow>(
      `UPDATE users
          SET plan = COALESCE($2, plan),
              email_verified_at = COALESCE($3, email_verified_at),
              updated_at = now()
        WHERE id = $1
        RETURNING ${USER_COLUMNS}`,
      [id, patch.plan ?? null, patch.emailVerifiedAt ?? null],
    );

    return toUser(requireRow(rows[0], 'user', id));
  }
  /**
   * Erase the account, and let the schema erase the rest.
   *
   * Every user-owned table declares `ON DELETE CASCADE` against `users`, so
   * one delete removes sessions, saved searches, watches, observations,
   * notifications, subscriptions and preferences with it. Doing it in the
   * database rather than in eight application deletes is what makes it
   * atomic: there is no window in which the user is gone and their watches
   * are still running.
   *
   * The counts are read first, inside the same transaction, so the summary
   * describes what this erasure actually removed rather than whatever the
   * table happened to hold a moment later.
   */
  async erase(id: string): Promise<ErasureSummary> {
    return withTransaction(async (client) => {
      const countOf = async (sql: string): Promise<number> => {
        const result = await client.query<{ count: string }>(sql, [id]);
        return Number(result.rows[0]?.count ?? 0);
      };

      const summary = {
        sessions: await countOf('SELECT count(*) FROM sessions WHERE user_id = $1'),
        savedSearches: await countOf('SELECT count(*) FROM trip_searches WHERE user_id = $1'),
        travelWatches: await countOf('SELECT count(*) FROM travel_watches WHERE user_id = $1'),
        priceObservations: await countOf(
          'SELECT count(*) FROM price_observations o' +
            ' JOIN travel_watches w ON w.id = o.watch_id WHERE w.user_id = $1',
        ),
        notifications: await countOf('SELECT count(*) FROM notifications WHERE user_id = $1'),
        pushSubscriptions: await countOf(
          'SELECT count(*) FROM push_subscriptions WHERE user_id = $1',
        ),
        preferences: await countOf('SELECT count(*) FROM user_preferences WHERE user_id = $1'),
        credentials: await countOf('SELECT count(*) FROM user_credentials WHERE user_id = $1'),
        emailVerificationTokens: await countOf(
          'SELECT count(*) FROM email_verification_tokens WHERE user_id = $1',
        ),
        passwordResetTokens: await countOf(
          'SELECT count(*) FROM password_reset_tokens WHERE user_id = $1',
        ),
      };

      const deleted = await client.query('DELETE FROM users WHERE id = $1', [id]);

      return { userExisted: (deleted.rowCount ?? 0) > 0, ...summary };
    });
  }
}

// --- Credentials and sessions ----------------------------------------------

interface CredentialRow {
  user_id: string;
  password_hash: string;
  updated_at: Date;
}

function toCredential(row: CredentialRow): UserCredentialRecord {
  return {
    userId: row.user_id,
    passwordHash: row.password_hash,
    updatedAt: toIso(row.updated_at),
  };
}

class PostgresUserCredentialRepository implements UserCredentialRepository {
  async findByUserId(userId: string): Promise<UserCredentialRecord | null> {
    const rows = await query<CredentialRow>(
      'SELECT user_id, password_hash, updated_at FROM user_credentials WHERE user_id = $1',
      [userId],
    );
    return rows[0] ? toCredential(rows[0]) : null;
  }

  async upsert(userId: string, passwordHash: string): Promise<UserCredentialRecord> {
    const rows = await query<CredentialRow>(
      `INSERT INTO user_credentials (user_id, password_hash)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE
         SET password_hash = EXCLUDED.password_hash, updated_at = now()
       RETURNING user_id, password_hash, updated_at`,
      [userId, passwordHash],
    );

    return toCredential(requireRow(rows[0], 'credential', userId));
  }
}

interface SessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  created_at: Date;
  expires_at: Date;
}

function toSession(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    createdAt: toIso(row.created_at),
    expiresAt: toIso(row.expires_at),
  };
}

class PostgresSessionRepository implements SessionRepository {
  async findByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    const rows = await query<SessionRow>(
      'SELECT id, user_id, token_hash, created_at, expires_at FROM sessions WHERE token_hash = $1',
      [tokenHash],
    );
    return rows[0] ? toSession(rows[0]) : null;
  }

  async create(input: Omit<SessionRecord, 'createdAt'>): Promise<SessionRecord> {
    const rows = await query<SessionRow>(
      `INSERT INTO sessions (id, user_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)
       RETURNING id, user_id, token_hash, created_at, expires_at`,
      [input.id, input.userId, input.tokenHash, input.expiresAt],
    );

    return toSession(requireRow(rows[0], 'session', input.id));
  }

  async delete(id: string): Promise<void> {
    await query('DELETE FROM sessions WHERE id = $1', [id]);
  }

  async deleteForUser(userId: string): Promise<void> {
    await query('DELETE FROM sessions WHERE user_id = $1', [userId]);
  }

  async deleteExpired(now: string): Promise<number> {
    const rows = await query<{ id: string }>(
      'DELETE FROM sessions WHERE expires_at <= $1 RETURNING id',
      [now],
    );
    return rows.length;
  }
}

// --- Email verification -----------------------------------------------------

interface EmailVerificationRow {
  id: string;
  user_id: string;
  token_hash: string;
  created_at: Date;
  expires_at: Date;
}

function toEmailVerificationToken(row: EmailVerificationRow): EmailVerificationTokenRecord {
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    createdAt: toIso(row.created_at),
    expiresAt: toIso(row.expires_at),
  };
}

class PostgresEmailVerificationRepository implements EmailVerificationRepository {
  async findByTokenHash(tokenHash: string): Promise<EmailVerificationTokenRecord | null> {
    const rows = await query<EmailVerificationRow>(
      'SELECT id, user_id, token_hash, created_at, expires_at' +
        ' FROM email_verification_tokens WHERE token_hash = $1',
      [tokenHash],
    );
    return rows[0] ? toEmailVerificationToken(rows[0]) : null;
  }

  async create(
    input: Omit<EmailVerificationTokenRecord, 'createdAt'>,
  ): Promise<EmailVerificationTokenRecord> {
    const rows = await query<EmailVerificationRow>(
      `INSERT INTO email_verification_tokens (id, user_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)
       RETURNING id, user_id, token_hash, created_at, expires_at`,
      [input.id, input.userId, input.tokenHash, input.expiresAt],
    );

    return toEmailVerificationToken(requireRow(rows[0], 'email verification token', input.id));
  }

  async delete(id: string): Promise<void> {
    await query('DELETE FROM email_verification_tokens WHERE id = $1', [id]);
  }

  async deleteForUser(userId: string): Promise<void> {
    await query('DELETE FROM email_verification_tokens WHERE user_id = $1', [userId]);
  }

  async deleteExpired(now: string): Promise<number> {
    const rows = await query<{ id: string }>(
      'DELETE FROM email_verification_tokens WHERE expires_at <= $1 RETURNING id',
      [now],
    );
    return rows.length;
  }
}

// --- Password reset ---------------------------------------------------------

interface PasswordResetRow {
  id: string;
  user_id: string;
  token_hash: string;
  created_at: Date;
  expires_at: Date;
}

function toPasswordResetToken(row: PasswordResetRow): PasswordResetTokenRecord {
  return {
    id: row.id,
    userId: row.user_id,
    tokenHash: row.token_hash,
    createdAt: toIso(row.created_at),
    expiresAt: toIso(row.expires_at),
  };
}

class PostgresPasswordResetRepository implements PasswordResetRepository {
  async findByTokenHash(tokenHash: string): Promise<PasswordResetTokenRecord | null> {
    const rows = await query<PasswordResetRow>(
      'SELECT id, user_id, token_hash, created_at, expires_at' +
        ' FROM password_reset_tokens WHERE token_hash = $1',
      [tokenHash],
    );
    return rows[0] ? toPasswordResetToken(rows[0]) : null;
  }

  async create(
    input: Omit<PasswordResetTokenRecord, 'createdAt'>,
  ): Promise<PasswordResetTokenRecord> {
    const rows = await query<PasswordResetRow>(
      `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)
       RETURNING id, user_id, token_hash, created_at, expires_at`,
      [input.id, input.userId, input.tokenHash, input.expiresAt],
    );

    return toPasswordResetToken(requireRow(rows[0], 'password reset token', input.id));
  }

  async delete(id: string): Promise<void> {
    await query('DELETE FROM password_reset_tokens WHERE id = $1', [id]);
  }

  async deleteForUser(userId: string): Promise<void> {
    await query('DELETE FROM password_reset_tokens WHERE user_id = $1', [userId]);
  }

  async deleteExpired(now: string): Promise<number> {
    const rows = await query<{ id: string }>(
      'DELETE FROM password_reset_tokens WHERE expires_at <= $1 RETURNING id',
      [now],
    );
    return rows.length;
  }
}

// --- Preferences -----------------------------------------------------------

interface PreferencesRow {
  user_id: string;
  explicit: Record<string, unknown>;
  inferred: Record<string, unknown>;
  updated_at: Date;
}

function toPreferences(row: PreferencesRow): UserPreferencesRecord {
  return {
    userId: row.user_id,
    explicit: row.explicit,
    inferred: row.inferred,
    updatedAt: toIso(row.updated_at),
  };
}

class PostgresUserPreferencesRepository implements UserPreferencesRepository {
  async find(userId: string): Promise<UserPreferencesRecord | null> {
    const rows = await query<PreferencesRow>(
      'SELECT user_id, explicit, inferred, updated_at FROM user_preferences WHERE user_id = $1',
      [userId],
    );
    return rows[0] ? toPreferences(rows[0]) : null;
  }

  async save(
    userId: string,
    patch: { explicit?: Record<string, unknown>; inferred?: Record<string, unknown> },
  ): Promise<UserPreferencesRecord> {
    // `||` merges one JSONB object into another, so each side is patched
    // independently. Saving what the user set must never discard what the
    // system inferred, or the reverse.
    const rows = await query<PreferencesRow>(
      `INSERT INTO user_preferences (user_id, explicit, inferred)
       VALUES ($1, $2::jsonb, $3::jsonb)
       ON CONFLICT (user_id) DO UPDATE
         SET explicit = user_preferences.explicit || EXCLUDED.explicit,
             inferred = user_preferences.inferred || EXCLUDED.inferred,
             updated_at = now()
       RETURNING user_id, explicit, inferred, updated_at`,
      [userId, JSON.stringify(patch.explicit ?? {}), JSON.stringify(patch.inferred ?? {})],
    );

    return toPreferences(requireRow(rows[0], 'preferences', userId));
  }
}

// --- Saved searches and watches --------------------------------------------

interface TripSearchRow {
  id: string;
  user_id: string;
  name: string;
  profile: SearchProfile;
  destinations: string[];
  created_at: Date;
  updated_at: Date;
}

function toTripSearch(row: TripSearchRow): TripSearchRecord {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    profile: row.profile,
    destinations: row.destinations,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

const SEARCH_COLUMNS = 'id, user_id, name, profile, destinations, created_at, updated_at';

class PostgresTripSearchRepository implements TripSearchRepository {
  async delete(id: string): Promise<void> {
    // The watch and its price history go with it: both reference this row
    // with ON DELETE CASCADE (0001_init.sql).
    await query('DELETE FROM trip_searches WHERE id = $1', [id]);
  }

  async findById(id: string): Promise<TripSearchRecord | null> {
    const rows = await query<TripSearchRow>(
      `SELECT ${SEARCH_COLUMNS} FROM trip_searches WHERE id = $1`,
      [id],
    );
    return rows[0] ? toTripSearch(rows[0]) : null;
  }

  async listByUser(userId: string): Promise<TripSearchRecord[]> {
    const rows = await query<TripSearchRow>(
      `SELECT ${SEARCH_COLUMNS}
         FROM trip_searches
        WHERE user_id = $1
        ORDER BY created_at DESC`,
      [userId],
    );
    return rows.map(toTripSearch);
  }

  async create(input: Omit<TripSearchRecord, 'createdAt' | 'updatedAt'>) {
    const rows = await query<TripSearchRow>(
      `INSERT INTO trip_searches (id, user_id, name, profile, destinations)
       VALUES ($1, $2, $3, $4::jsonb, $5)
       RETURNING ${SEARCH_COLUMNS}`,
      [input.id, input.userId, input.name, JSON.stringify(input.profile), [...input.destinations]],
    );
    return toTripSearch(requireRow(rows[0], 'trip search', input.id));
  }

  async update(
    id: string,
    patch: Partial<Pick<TripSearchRecord, 'name' | 'profile' | 'destinations'>>,
  ) {
    const rows = await query<TripSearchRow>(
      `UPDATE trip_searches
          SET name = COALESCE($2, name),
              profile = COALESCE($3::jsonb, profile),
              destinations = COALESCE($4, destinations),
              updated_at = now()
        WHERE id = $1
        RETURNING ${SEARCH_COLUMNS}`,
      [
        id,
        patch.name ?? null,
        patch.profile ? JSON.stringify(patch.profile) : null,
        patch.destinations ? [...patch.destinations] : null,
      ],
    );
    return toTripSearch(requireRow(rows[0], 'trip search', id));
  }
}

interface TravelWatchRow {
  id: string;
  user_id: string;
  trip_search_id: string;
  status: TravelWatchRecord['status'];
  priority: TravelWatchRecord['priority'];
  last_run_at: Date | null;
  next_run_at: Date;
  best_known_total: string | null;
  best_known_currency: string | null;
  created_at: Date;
}

function toTravelWatch(row: TravelWatchRow): TravelWatchRecord {
  return {
    id: row.id,
    userId: row.user_id,
    tripSearchId: row.trip_search_id,
    status: row.status,
    priority: row.priority,
    lastRunAt: toIsoOrNull(row.last_run_at),
    nextRunAt: toIso(row.next_run_at),
    bestKnownTotal: toMoney(row.best_known_total, row.best_known_currency),
    createdAt: toIso(row.created_at),
  };
}

const WATCH_COLUMNS = `id, user_id, trip_search_id, status, priority, last_run_at, next_run_at,
                       best_known_total, best_known_currency, created_at`;

class PostgresTravelWatchRepository implements TravelWatchRepository {
  async findById(id: string): Promise<TravelWatchRecord | null> {
    const rows = await query<TravelWatchRow>(
      `SELECT ${WATCH_COLUMNS} FROM travel_watches WHERE id = $1`,
      [id],
    );
    return rows[0] ? toTravelWatch(rows[0]) : null;
  }

  async listByUser(userId: string): Promise<TravelWatchRecord[]> {
    const rows = await query<TravelWatchRow>(
      `SELECT ${WATCH_COLUMNS} FROM travel_watches WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId],
    );
    return rows.map(toTravelWatch);
  }

  async listDue(now: string, limit: number): Promise<TravelWatchRecord[]> {
    // Matches the partial index `travel_watches_due_idx`, which exists for
    // exactly this query: the scheduler's hot path.
    const rows = await query<TravelWatchRow>(
      `SELECT ${WATCH_COLUMNS}
         FROM travel_watches
        WHERE status = 'active' AND next_run_at <= $1
        ORDER BY next_run_at ASC
        LIMIT $2`,
      [now, limit],
    );
    return rows.map(toTravelWatch);
  }

  async create(input: Omit<TravelWatchRecord, 'createdAt'>): Promise<TravelWatchRecord> {
    const rows = await query<TravelWatchRow>(
      `INSERT INTO travel_watches
         (id, user_id, trip_search_id, status, priority, last_run_at, next_run_at,
          best_known_total, best_known_currency)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING ${WATCH_COLUMNS}`,
      [
        input.id,
        input.userId,
        input.tripSearchId,
        input.status,
        input.priority,
        input.lastRunAt,
        input.nextRunAt,
        input.bestKnownTotal?.amount ?? null,
        input.bestKnownTotal?.currency ?? null,
      ],
    );
    return toTravelWatch(requireRow(rows[0], 'travel watch', input.id));
  }

  async update(
    id: string,
    patch: Partial<
      Pick<TravelWatchRecord, 'status' | 'priority' | 'lastRunAt' | 'nextRunAt' | 'bestKnownTotal'>
    >,
  ): Promise<TravelWatchRecord> {
    // `bestKnownTotal` can legitimately be set to null, so a COALESCE would be
    // wrong for it: a sentinel flag says "this key was present in the patch".
    const clearsBest = 'bestKnownTotal' in patch && patch.bestKnownTotal === null;

    const rows = await query<TravelWatchRow>(
      `UPDATE travel_watches
          SET status = COALESCE($2, status),
              priority = COALESCE($3, priority),
              last_run_at = COALESCE($4, last_run_at),
              next_run_at = COALESCE($5, next_run_at),
              best_known_total = CASE WHEN $8 THEN NULL ELSE COALESCE($6, best_known_total) END,
              best_known_currency = CASE WHEN $8 THEN NULL ELSE COALESCE($7, best_known_currency) END
        WHERE id = $1
        RETURNING ${WATCH_COLUMNS}`,
      [
        id,
        patch.status ?? null,
        patch.priority ?? null,
        patch.lastRunAt ?? null,
        patch.nextRunAt ?? null,
        patch.bestKnownTotal?.amount ?? null,
        patch.bestKnownTotal?.currency ?? null,
        clearsBest,
      ],
    );
    return toTravelWatch(requireRow(rows[0], 'travel watch', id));
  }
}

// --- Price history ---------------------------------------------------------

interface PriceRow {
  id: string;
  watch_id: string;
  component_type: PriceObservationRecord['componentType'];
  component_id: string;
  amount: string;
  currency: string;
  provider_id: string;
  observed_at: Date;
  conditions: string | null;
}

function toObservation(row: PriceRow): PriceObservationRecord {
  const amount = toMoney(row.amount, row.currency);
  if (!amount) {
    throw new AppError('INTERNAL_ERROR', 'Price observation has no amount', {
      context: { id: row.id },
    });
  }

  return {
    id: row.id,
    watchId: row.watch_id,
    componentType: row.component_type,
    componentId: row.component_id,
    amount,
    providerId: row.provider_id,
    observedAt: toIso(row.observed_at),
    conditions: row.conditions,
  };
}

const PRICE_COLUMNS = `id, watch_id, component_type, component_id, amount, currency,
                       provider_id, observed_at, conditions`;

class PostgresPriceHistoryRepository implements PriceHistoryRepository {
  async record(observation: Omit<PriceObservationRecord, 'id'>): Promise<PriceObservationRecord> {
    const rows = await query<PriceRow>(
      `INSERT INTO price_history
         (watch_id, component_type, component_id, amount, currency, provider_id,
          observed_at, conditions)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING ${PRICE_COLUMNS}`,
      [
        observation.watchId,
        observation.componentType,
        observation.componentId,
        observation.amount.amount,
        observation.amount.currency,
        observation.providerId,
        observation.observedAt,
        observation.conditions,
      ],
    );

    return toObservation(requireRow(rows[0], 'price observation', observation.watchId));
  }

  async listForWatch(watchId: string, limit = 100): Promise<PriceObservationRecord[]> {
    const rows = await query<PriceRow>(
      `SELECT ${PRICE_COLUMNS}
         FROM price_history
        WHERE watch_id = $1
        ORDER BY observed_at DESC
        LIMIT $2`,
      [watchId, limit],
    );
    return rows.map(toObservation);
  }

  async findLowest(
    watchId: string,
    componentType: PriceObservationRecord['componentType'],
    currency: string,
  ): Promise<PriceObservationRecord | null> {
    // Ordered by amount then by time, so the *first* time a price was seen wins
    // a tie. "It has been this cheap since Tuesday" is the honest answer.
    const rows = await query<PriceRow>(
      `SELECT ${PRICE_COLUMNS}
         FROM price_history
        WHERE watch_id = $1 AND component_type = $2 AND currency = $3
        ORDER BY amount ASC, observed_at ASC
        LIMIT 1`,
      [watchId, componentType, currency],
    );
    return rows[0] ? toObservation(rows[0]) : null;
  }

  async pruneOlderThan(before: string): Promise<number> {
    // `DISTINCT ON` picks one row per group in the ORDER BY's first-per-group
    // sense, which with `amount ASC` is the cheapest ever seen. Those survive
    // whatever their age; everything else older than the cutoff goes.
    const rows = await query<{ id: string }>(
      `DELETE FROM price_history p
        WHERE p.observed_at < $1
          AND p.id NOT IN (
            SELECT DISTINCT ON (watch_id, component_type, currency) id
              FROM price_history
             ORDER BY watch_id, component_type, currency, amount ASC, observed_at ASC
          )
        RETURNING p.id`,
      [before],
    );
    return rows.length;
  }
}

// --- Notifications and push subscriptions ----------------------------------

interface NotificationRow {
  id: string;
  user_id: string;
  watch_id: string | null;
  severity: NotificationRecord['severity'];
  title: string;
  body: string;
  url: string | null;
  created_at: Date;
  read_at: Date | null;
  delivered_at: Date | null;
}

function toNotification(row: NotificationRow): NotificationRecord {
  return {
    id: row.id,
    userId: row.user_id,
    watchId: row.watch_id,
    severity: row.severity,
    title: row.title,
    body: row.body,
    url: row.url,
    createdAt: toIso(row.created_at),
    readAt: toIsoOrNull(row.read_at),
    deliveredAt: toIsoOrNull(row.delivered_at),
  };
}

const NOTIFICATION_COLUMNS = `id, user_id, watch_id, severity, title, body, url, created_at,
                              read_at, delivered_at`;

class PostgresNotificationRepository implements NotificationRepository {
  async findById(id: string): Promise<NotificationRecord | null> {
    const rows = await query<NotificationRow>(
      `SELECT ${NOTIFICATION_COLUMNS} FROM notifications WHERE id = $1`,
      [id],
    );
    return rows[0] ? toNotification(rows[0]) : null;
  }

  async create(input: Omit<NotificationRecord, 'id' | 'createdAt'>): Promise<NotificationRecord> {
    const rows = await query<NotificationRow>(
      `INSERT INTO notifications
         (user_id, watch_id, severity, title, body, url, read_at, delivered_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING ${NOTIFICATION_COLUMNS}`,
      [
        input.userId,
        input.watchId,
        input.severity,
        input.title,
        input.body,
        input.url,
        input.readAt,
        input.deliveredAt,
      ],
    );
    return toNotification(requireRow(rows[0], 'notification', input.userId));
  }

  async listByUser(userId: string, limit = 50): Promise<NotificationRecord[]> {
    const rows = await query<NotificationRow>(
      `SELECT ${NOTIFICATION_COLUMNS}
         FROM notifications
        WHERE user_id = $1
        ORDER BY created_at DESC
        LIMIT $2`,
      [userId, limit],
    );
    return rows.map(toNotification);
  }

  async markRead(id: string, readAt: string): Promise<void> {
    await query('UPDATE notifications SET read_at = $2 WHERE id = $1', [id, readAt]);
  }

  async markDelivered(id: string, deliveredAt: string): Promise<void> {
    await query('UPDATE notifications SET delivered_at = $2 WHERE id = $1', [id, deliveredAt]);
  }
}

interface PushRow {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  created_at: Date;
}

function toPushSubscription(row: PushRow): PushSubscriptionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    endpoint: row.endpoint,
    keys: { p256dh: row.p256dh, auth: row.auth },
    createdAt: toIso(row.created_at),
  };
}

class PostgresPushSubscriptionRepository implements PushSubscriptionRepository {
  async listByUser(userId: string): Promise<PushSubscriptionRecord[]> {
    const rows = await query<PushRow>(
      `SELECT id, user_id, endpoint, p256dh, auth, created_at
         FROM push_subscriptions
        WHERE user_id = $1
        ORDER BY created_at DESC`,
      [userId],
    );
    return rows.map(toPushSubscription);
  }

  async create(
    input: Omit<PushSubscriptionRecord, 'id' | 'createdAt'>,
  ): Promise<PushSubscriptionRecord> {
    // An endpoint is unique per browser install. Re-subscribing replaces the
    // keys rather than accumulating dead rows that later fail to deliver.
    const rows = await query<PushRow>(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (endpoint) DO UPDATE
         SET user_id = EXCLUDED.user_id,
             p256dh = EXCLUDED.p256dh,
             auth = EXCLUDED.auth
       RETURNING id, user_id, endpoint, p256dh, auth, created_at`,
      [input.userId, input.endpoint, input.keys.p256dh, input.keys.auth],
    );
    return toPushSubscription(requireRow(rows[0], 'push subscription', input.endpoint));
  }

  async deleteByEndpoint(endpoint: string): Promise<void> {
    await query('DELETE FROM push_subscriptions WHERE endpoint = $1', [endpoint]);
  }
}

class PostgresProviderRequestRepository implements ProviderRequestRepository {
  async record(entry: Omit<ProviderRequestRecord, 'createdAt'>): Promise<void> {
    await query(
      `INSERT INTO provider_requests (provider_id, kind, status, duration_ms, result_count)
       VALUES ($1, $2, $3, $4, $5)`,
      [entry.providerId, entry.kind, entry.status, Math.round(entry.durationMs), entry.resultCount],
    );
  }

  async summarise(since: IsoDateTime): Promise<ProviderCallSummary[]> {
    // `percentile_disc` is nearest-rank, the same method the in-memory
    // backend uses (`src/providers/observability.ts`), so both agree.
    const rows = await query<{
      provider_id: string;
      kind: string;
      calls: string;
      errors: string;
      timeouts: string;
      rate_limited: string;
      p50: number;
      p95: number;
    }>(
      `SELECT provider_id,
              kind,
              count(*) AS calls,
              count(*) FILTER (WHERE status = 'error') AS errors,
              count(*) FILTER (WHERE status = 'timeout') AS timeouts,
              count(*) FILTER (WHERE status = 'rate_limited') AS rate_limited,
              percentile_disc(0.5) WITHIN GROUP (ORDER BY duration_ms) AS p50,
              percentile_disc(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95
         FROM provider_requests
        WHERE created_at >= $1
        GROUP BY provider_id, kind
        ORDER BY count(*) DESC, provider_id`,
      [since],
    );

    return rows.map((row) => ({
      providerId: row.provider_id,
      kind: row.kind,
      calls: Number(row.calls),
      errors: Number(row.errors),
      timeouts: Number(row.timeouts),
      rateLimited: Number(row.rate_limited),
      p50Ms: Number(row.p50),
      p95Ms: Number(row.p95),
    }));
  }

  async deleteBefore(before: IsoDateTime): Promise<number> {
    const rows = await query<{ id: string }>(
      'DELETE FROM provider_requests WHERE created_at < $1 RETURNING id',
      [before],
    );
    return rows.length;
  }
}

/** The Postgres-backed persistence surface. */
export function createPostgresRepositories(): Repositories {
  return {
    users: new PostgresUserRepository(),
    credentials: new PostgresUserCredentialRepository(),
    sessions: new PostgresSessionRepository(),
    emailVerification: new PostgresEmailVerificationRepository(),
    passwordReset: new PostgresPasswordResetRepository(),
    preferences: new PostgresUserPreferencesRepository(),
    tripSearches: new PostgresTripSearchRepository(),
    travelWatches: new PostgresTravelWatchRepository(),
    priceHistory: new PostgresPriceHistoryRepository(),
    notifications: new PostgresNotificationRepository(),
    pushSubscriptions: new PostgresPushSubscriptionRepository(),
    providerRequests: new PostgresProviderRequestRepository(),
    backend: 'postgres',
  };
}
