import { money, type Money } from '@/core/money';
import type { RouteAggregate } from '@/core/cleanup/prune';
import { AppError } from '@/lib/errors';
import { query, withTransaction } from './client';
import type { RepositoryOptions } from './memory';
import type {
  LiteApiEnvironment,
  KiwiOffersKey,
  KiwiOffersRepository,
  KiwiOffersRow,
  RouteAggregatesRepository,
  PriceAlertRecord,
  PriceAlertRepository,
  RouteGraphEdge,
  RouteGraphRepository,
  RecommendationListKey,
  RecommendationListRepository,
  RecommendationListRow,
  LiteApiFlightsKey,
  LiteApiFlightsRow,
  LiteApiHotelRow,
  LiteApiRatesKey,
  LiteApiRatesRow,
  LiteApiRunFinish,
  LiteApiRunRecord,
  LiteApiRunStart,
  LiteApiSnapshotRepository,
  VisitorSearchInput,
  VisitorSearchRecord,
  VisitorSearchRepository,
} from './repository';
import { VISITOR_SEARCH_DEDUPE_MS, VISITOR_SEARCH_WINDOW_MS } from './repository';
import type { IsoDate, SearchProfile } from '@/core/trip/types';
import type {
  AlertPreferencesInput,
  AlertPreferencesRecord,
  AlertPreferencesRepository,
  EmailVerificationRepository,
  EmailVerificationTokenRecord,
  ErasureSummary,
  EmailChangeRepository,
  EmailChangeTokenRecord,
  EmergencyContactRecord,
  EmergencyContactRepository,
  NotificationRecord,
  NotificationRepository,
  PasswordResetRepository,
  PasswordResetTokenRecord,
  DayStopInput,
  DayStopPlacement,
  DayStopRecord,
  PlanItemInput,
  PlanItemRecord,
  PlanItemRepository,
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
import type { IsoDateTime } from '@/core/trip/types';
import { splitFromJson, splitToJson } from '@/trip-hub/split-json';

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

  async updateEmail(id: string, newEmail: string): Promise<UserRecord> {
    // Re-checked for a conflict here, atomically with the write, rather than
    // trusting a check made when the change was first requested - that may
    // have been up to an hour earlier (AuthService.requestEmailChange), long
    // enough for someone else to have taken the address since.
    const rows = await query<UserRow>(
      `UPDATE users
          SET email = $2,
              email_verified_at = NULL,
              updated_at = now()
        WHERE id = $1
          AND NOT EXISTS (
            SELECT 1 FROM users other WHERE lower(other.email) = lower($2) AND other.id <> $1
          )
        RETURNING ${USER_COLUMNS}`,
      [id, newEmail],
    );

    if (!rows[0]) {
      throw new AppError('CONFLICT', `Email already taken or account not found: ${id}`, {
        publicMessage: 'An account with that email already exists.',
      });
    }

    return toUser(rows[0]);
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
        emailChangeTokens: await countOf(
          'SELECT count(*) FROM email_change_tokens WHERE user_id = $1',
        ),
        trips: await countOf('SELECT count(*) FROM trips WHERE owner_id = $1'),
        emergencyContacts: await countOf(
          'SELECT count(*) FROM emergency_contacts WHERE user_id = $1',
        ),
      };

      // A seat on somebody else's trip outlives the account, because their
      // ledger needs it; the name does not. The foreign key then nulls user_id.
      await client.query("UPDATE trip_members SET name = 'Former member' WHERE user_id = $1", [id]);

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

// --- Email change -----------------------------------------------------------

interface EmailChangeRow {
  id: string;
  user_id: string;
  new_email: string;
  token_hash: string;
  created_at: Date;
  expires_at: Date;
}

function toEmailChangeToken(row: EmailChangeRow): EmailChangeTokenRecord {
  return {
    id: row.id,
    userId: row.user_id,
    newEmail: row.new_email,
    tokenHash: row.token_hash,
    createdAt: toIso(row.created_at),
    expiresAt: toIso(row.expires_at),
  };
}

class PostgresEmailChangeRepository implements EmailChangeRepository {
  async findByTokenHash(tokenHash: string): Promise<EmailChangeTokenRecord | null> {
    const rows = await query<EmailChangeRow>(
      'SELECT id, user_id, new_email, token_hash, created_at, expires_at' +
        ' FROM email_change_tokens WHERE token_hash = $1',
      [tokenHash],
    );
    return rows[0] ? toEmailChangeToken(rows[0]) : null;
  }

  async create(input: Omit<EmailChangeTokenRecord, 'createdAt'>): Promise<EmailChangeTokenRecord> {
    const rows = await query<EmailChangeRow>(
      `INSERT INTO email_change_tokens (id, user_id, new_email, token_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, user_id, new_email, token_hash, created_at, expires_at`,
      [input.id, input.userId, input.newEmail, input.tokenHash, input.expiresAt],
    );

    return toEmailChangeToken(requireRow(rows[0], 'email change token', input.id));
  }

  async delete(id: string): Promise<void> {
    await query('DELETE FROM email_change_tokens WHERE id = $1', [id]);
  }

  async deleteForUser(userId: string): Promise<void> {
    await query('DELETE FROM email_change_tokens WHERE user_id = $1', [userId]);
  }

  async deleteExpired(now: string): Promise<number> {
    const rows = await query<{ id: string }>(
      'DELETE FROM email_change_tokens WHERE expires_at <= $1 RETURNING id',
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

// --- Alert preferences -----------------------------------------------------

interface AlertPreferencesRow {
  user_id: string;
  home_airport: string | null;
  destinations: string[];
  budget_amount: string | null;
  budget_currency: string | null;
  earliest_departure: string | null;
  latest_departure: string | null;
  price_drop_alerts: boolean;
  updated_at: Date;
}

// Dates are read as text (`to_char`), never as a `Date`, so a calendar day cannot
// shift with the server's timezone.
const ALERT_PREFERENCES_COLUMNS = `user_id, home_airport, destinations, budget_amount, budget_currency,
  to_char(earliest_departure, 'YYYY-MM-DD') AS earliest_departure,
  to_char(latest_departure, 'YYYY-MM-DD') AS latest_departure,
  price_drop_alerts, updated_at`;

function toAlertPreferences(row: AlertPreferencesRow): AlertPreferencesRecord {
  return {
    userId: row.user_id,
    homeAirport: row.home_airport,
    destinations: row.destinations,
    budget: toMoney(row.budget_amount, row.budget_currency),
    earliestDeparture: row.earliest_departure,
    latestDeparture: row.latest_departure,
    priceDropAlerts: row.price_drop_alerts,
    updatedAt: toIso(row.updated_at),
  };
}

class PostgresAlertPreferencesRepository implements AlertPreferencesRepository {
  async find(userId: string): Promise<AlertPreferencesRecord | null> {
    const rows = await query<AlertPreferencesRow>(
      `SELECT ${ALERT_PREFERENCES_COLUMNS} FROM alert_preferences WHERE user_id = $1`,
      [userId],
    );
    return rows[0] ? toAlertPreferences(rows[0]) : null;
  }

  async save(userId: string, input: AlertPreferencesInput): Promise<AlertPreferencesRecord> {
    const rows = await query<AlertPreferencesRow>(
      `INSERT INTO alert_preferences
         (user_id, home_airport, destinations, budget_amount, budget_currency,
          earliest_departure, latest_departure, price_drop_alerts)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (user_id) DO UPDATE
         SET home_airport = EXCLUDED.home_airport,
             destinations = EXCLUDED.destinations,
             budget_amount = EXCLUDED.budget_amount,
             budget_currency = EXCLUDED.budget_currency,
             earliest_departure = EXCLUDED.earliest_departure,
             latest_departure = EXCLUDED.latest_departure,
             price_drop_alerts = EXCLUDED.price_drop_alerts,
             updated_at = now()
       RETURNING ${ALERT_PREFERENCES_COLUMNS}`,
      [
        userId,
        input.homeAirport,
        [...input.destinations],
        input.budget?.amount ?? null,
        input.budget?.currency ?? null,
        input.earliestDeparture,
        input.latestDeparture,
        input.priceDropAlerts,
      ],
    );

    return toAlertPreferences(requireRow(rows[0], 'alert preferences', userId));
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

  async upsert(input: Omit<TripSearchRecord, 'createdAt' | 'updatedAt'>) {
    // The WHERE keeps a row owned by someone else untouched; it then returns
    // nothing and `requireRow` reports it.
    const rows = await query<TripSearchRow>(
      `INSERT INTO trip_searches (id, user_id, name, profile, destinations)
       VALUES ($1, $2, $3, $4::jsonb, $5)
       ON CONFLICT (id) DO UPDATE
          SET name = EXCLUDED.name,
              profile = EXCLUDED.profile,
              destinations = EXCLUDED.destinations,
              updated_at = now()
        WHERE trip_searches.user_id = EXCLUDED.user_id
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

// --- Trip hub --------------------------------------------------------------

interface TripRow {
  id: string;
  owner_id: string;
  name: string;
  destination: string;
  destination_country: string | null;
  start_date: string | null;
  end_date: string | null;
  created_at: Date;
  updated_at: Date;
}

// Dates are read as text so a calendar day cannot shift with the server's timezone.
const TRIP_COLUMNS = `id, owner_id, name, destination, destination_country,
  to_char(start_date, 'YYYY-MM-DD') AS start_date,
  to_char(end_date, 'YYYY-MM-DD') AS end_date,
  created_at, updated_at`;

function toTrip(row: TripRow): TripRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    destination: row.destination,
    destinationCountry: row.destination_country,
    startDate: row.start_date,
    endDate: row.end_date,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

interface TripMemberRow {
  id: string;
  trip_id: string;
  user_id: string | null;
  name: string;
  created_at: Date;
}

const MEMBER_COLUMNS = 'id, trip_id, user_id, name, created_at';

function toTripMember(row: TripMemberRow): TripMemberRecord {
  return {
    id: row.id,
    tripId: row.trip_id,
    userId: row.user_id,
    name: row.name,
    createdAt: toIso(row.created_at),
  };
}

interface TripInviteRow {
  id: string;
  trip_id: string;
  token_hash: string;
  created_by: string;
  created_at: Date;
  expires_at: Date;
  revoked_at: Date | null;
  uses: number;
  max_uses: number;
}

const INVITE_COLUMNS =
  'id, trip_id, token_hash, created_by, created_at, expires_at, revoked_at, uses, max_uses';

function toTripInvite(row: TripInviteRow): TripInviteRecord {
  return {
    id: row.id,
    tripId: row.trip_id,
    tokenHash: row.token_hash,
    createdBy: row.created_by,
    createdAt: toIso(row.created_at),
    expiresAt: toIso(row.expires_at),
    revokedAt: toIsoOrNull(row.revoked_at),
    uses: row.uses,
    maxUses: row.max_uses,
  };
}

class PostgresTripInviteRepository implements TripInviteRepository {
  async create(input: TripInviteInput): Promise<TripInviteRecord> {
    const rows = await query<TripInviteRow>(
      `INSERT INTO trip_invites (trip_id, token_hash, created_by, expires_at, max_uses)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${INVITE_COLUMNS}`,
      [input.tripId, input.tokenHash, input.createdBy, input.expiresAt, input.maxUses],
    );
    return toTripInvite(requireRow(rows[0], 'trip invite', input.tripId));
  }

  async findByHash(tokenHash: string): Promise<TripInviteRecord | null> {
    const rows = await query<TripInviteRow>(
      `SELECT ${INVITE_COLUMNS} FROM trip_invites WHERE token_hash = $1`,
      [tokenHash],
    );
    return rows[0] ? toTripInvite(rows[0]) : null;
  }

  async listActiveByTrip(tripId: string, at: string): Promise<TripInviteRecord[]> {
    const rows = await query<TripInviteRow>(
      `SELECT ${INVITE_COLUMNS} FROM trip_invites
        WHERE trip_id = $1 AND revoked_at IS NULL AND expires_at > $2
        ORDER BY created_at DESC, id`,
      [tripId, at],
    );
    return rows.map(toTripInvite);
  }

  async revoke(tripId: string, at: string, inviteId?: string): Promise<number> {
    const rows = await query<{ id: string }>(
      `UPDATE trip_invites SET revoked_at = $2
        WHERE trip_id = $1 AND revoked_at IS NULL AND ($3::uuid IS NULL OR id = $3::uuid)
        RETURNING id`,
      [tripId, at, inviteId ?? null],
    );
    return rows.length;
  }

  async claim(id: string, at: string): Promise<boolean> {
    const rows = await query<{ id: string }>(
      `UPDATE trip_invites SET uses = uses + 1
        WHERE id = $1 AND revoked_at IS NULL AND expires_at > $2 AND uses < max_uses
        RETURNING id`,
      [id, at],
    );
    return rows.length === 1;
  }
}

class PostgresTripRepository implements TripRepository {
  async findById(id: string): Promise<TripRecord | null> {
    const rows = await query<TripRow>(`SELECT ${TRIP_COLUMNS} FROM trips WHERE id = $1`, [id]);
    return rows[0] ? toTrip(rows[0]) : null;
  }

  async listForUser(userId: string): Promise<TripRecord[]> {
    const rows = await query<TripRow>(
      `SELECT ${TRIP_COLUMNS}
         FROM trips
        WHERE owner_id = $1
           OR id IN (SELECT trip_id FROM trip_members WHERE user_id = $1)
        ORDER BY created_at DESC, id`,
      [userId],
    );
    return rows.map(toTrip);
  }

  async create(input: TripInput, ownerName: string): Promise<TripRecord> {
    return withTransaction(async (client) => {
      const inserted = await client.query<TripRow>(
        `INSERT INTO trips (owner_id, name, destination, destination_country, start_date, end_date)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING ${TRIP_COLUMNS}`,
        [
          input.ownerId,
          input.name,
          input.destination,
          input.destinationCountry,
          input.startDate,
          input.endDate,
        ],
      );
      const row = requireRow(inserted.rows[0], 'trip', input.name);
      await client.query('INSERT INTO trip_members (trip_id, user_id, name) VALUES ($1, $2, $3)', [
        row.id,
        input.ownerId,
        ownerName,
      ]);
      return toTrip(row);
    });
  }

  async update(
    id: string,
    patch: Partial<
      Pick<TripRecord, 'name' | 'destination' | 'destinationCountry' | 'startDate' | 'endDate'>
    >,
  ): Promise<TripRecord> {
    // COALESCE would make a date impossible to clear, so each column says
    // whether it was supplied.
    const rows = await query<TripRow>(
      `UPDATE trips
          SET name = CASE WHEN $2::boolean THEN $3 ELSE name END,
              destination = CASE WHEN $4::boolean THEN $5 ELSE destination END,
              destination_country = CASE WHEN $6::boolean THEN $7 ELSE destination_country END,
              start_date = CASE WHEN $8::boolean THEN $9::date ELSE start_date END,
              end_date = CASE WHEN $10::boolean THEN $11::date ELSE end_date END,
              updated_at = now()
        WHERE id = $1
        RETURNING ${TRIP_COLUMNS}`,
      [
        id,
        patch.name !== undefined,
        patch.name ?? null,
        patch.destination !== undefined,
        patch.destination ?? null,
        patch.destinationCountry !== undefined,
        patch.destinationCountry ?? null,
        patch.startDate !== undefined,
        patch.startDate ?? null,
        patch.endDate !== undefined,
        patch.endDate ?? null,
      ],
    );
    return toTrip(requireRow(rows[0], 'trip', id));
  }

  async delete(id: string): Promise<void> {
    // Members, plan items and expenses go with it: all reference this row
    // with ON DELETE CASCADE (0009_trip_hub.sql).
    await query('DELETE FROM trips WHERE id = $1', [id]);
  }

  async listMembers(tripId: string): Promise<TripMemberRecord[]> {
    const rows = await query<TripMemberRow>(
      `SELECT ${MEMBER_COLUMNS} FROM trip_members WHERE trip_id = $1 ORDER BY created_at, id`,
      [tripId],
    );
    return rows.map(toTripMember);
  }

  async addMember(input: Omit<TripMemberRecord, 'id' | 'createdAt'>): Promise<TripMemberRecord> {
    const rows = await query<TripMemberRow>(
      `INSERT INTO trip_members (trip_id, user_id, name) VALUES ($1, $2, $3)
       RETURNING ${MEMBER_COLUMNS}`,
      [input.tripId, input.userId, input.name],
    );
    return toTripMember(requireRow(rows[0], 'trip member', input.name));
  }

  async removeMember(tripId: string, memberId: string): Promise<void> {
    await query('DELETE FROM trip_members WHERE trip_id = $1 AND id = $2', [tripId, memberId]);
  }
}

interface PlanItemRow {
  id: string;
  trip_id: string;
  kind: PlanItemRecord['kind'];
  title: string;
  item_date: string | null;
  starts_at: string | null;
  price_amount: string | null;
  price_currency: string | null;
  partner_offer_id: string | null;
  outbound_url: string | null;
  status: PlanItemRecord['status'];
  created_at: Date;
  updated_at: Date;
}

const PLAN_ITEM_COLUMNS = `id, trip_id, kind, title,
  to_char(item_date, 'YYYY-MM-DD') AS item_date,
  starts_at, price_amount, price_currency, partner_offer_id, outbound_url, status,
  created_at, updated_at`;

function toPlanItem(row: PlanItemRow): PlanItemRecord {
  return {
    id: row.id,
    tripId: row.trip_id,
    kind: row.kind,
    title: row.title,
    date: row.item_date,
    startsAt: row.starts_at,
    price: toMoney(row.price_amount, row.price_currency),
    partnerOfferId: row.partner_offer_id,
    outboundUrl: row.outbound_url,
    status: row.status,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

interface DayStopRow {
  id: string;
  trip_id: string;
  title: string;
  outbound_url: string | null;
  plan_day: number;
  plan_position: number;
}

const DAY_STOP_COLUMNS = 'id, trip_id, title, outbound_url, plan_day, plan_position';

function toDayStop(row: DayStopRow): DayStopRecord {
  return {
    id: row.id,
    tripId: row.trip_id,
    title: row.title,
    url: row.outbound_url,
    day: row.plan_day,
    position: row.plan_position,
  };
}

class PostgresPlanItemRepository implements PlanItemRepository {
  async createStop(input: DayStopInput): Promise<DayStopRecord> {
    const rows = await query<DayStopRow>(
      `INSERT INTO plan_items (trip_id, kind, title, outbound_url, status, plan_day, plan_position)
       VALUES ($1, 'activity', $2, $3, 'idea', $4, $5)
       RETURNING ${DAY_STOP_COLUMNS}`,
      [input.tripId, input.title, input.url, input.day, input.position],
    );
    return toDayStop(requireRow(rows[0], 'plan stop', input.title));
  }

  async listStops(tripId: string): Promise<DayStopRecord[]> {
    const rows = await query<DayStopRow>(
      `SELECT ${DAY_STOP_COLUMNS} FROM plan_items
        WHERE trip_id = $1 AND plan_day IS NOT NULL
        ORDER BY plan_day, plan_position, id`,
      [tripId],
    );
    return rows.map(toDayStop);
  }

  async placeStops(tripId: string, placements: readonly DayStopPlacement[]): Promise<void> {
    if (placements.length === 0) return;
    await query(
      `UPDATE plan_items AS p
          SET plan_day = v.day, plan_position = v.position, updated_at = now()
         FROM unnest($2::uuid[], $3::int[], $4::int[]) AS v(id, day, position)
        WHERE p.id = v.id AND p.trip_id = $1 AND p.plan_day IS NOT NULL`,
      [
        tripId,
        placements.map((entry) => entry.id),
        placements.map((entry) => entry.day),
        placements.map((entry) => entry.position),
      ],
    );
  }

  async findById(id: string): Promise<PlanItemRecord | null> {
    const rows = await query<PlanItemRow>(
      `SELECT ${PLAN_ITEM_COLUMNS} FROM plan_items WHERE id = $1`,
      [id],
    );
    return rows[0] ? toPlanItem(rows[0]) : null;
  }

  async listByTrip(tripId: string): Promise<PlanItemRecord[]> {
    const rows = await query<PlanItemRow>(
      `SELECT ${PLAN_ITEM_COLUMNS} FROM plan_items WHERE trip_id = $1 ORDER BY created_at, id`,
      [tripId],
    );
    return rows.map(toPlanItem);
  }

  async create(input: PlanItemInput): Promise<PlanItemRecord> {
    const rows = await query<PlanItemRow>(
      `INSERT INTO plan_items
         (trip_id, kind, title, item_date, starts_at, price_amount, price_currency,
          partner_offer_id, outbound_url, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING ${PLAN_ITEM_COLUMNS}`,
      [
        input.tripId,
        input.kind,
        input.title,
        input.date,
        input.startsAt,
        input.price?.amount ?? null,
        input.price?.currency ?? null,
        input.partnerOfferId,
        input.outboundUrl,
        input.status,
      ],
    );
    return toPlanItem(requireRow(rows[0], 'plan item', input.title));
  }

  async update(id: string, patch: Partial<Omit<PlanItemInput, 'tripId'>>): Promise<PlanItemRecord> {
    // Read-merge-write: a plan item is small, and one UPDATE with every
    // column explicit is clearer than a flag per column for ten of them.
    const existing = requireRow(await this.findById(id), 'plan item', id);
    const next = { ...existing, ...patch };

    const rows = await query<PlanItemRow>(
      `UPDATE plan_items
          SET kind = $2, title = $3, item_date = $4, starts_at = $5,
              price_amount = $6, price_currency = $7, partner_offer_id = $8,
              outbound_url = $9, status = $10, updated_at = now()
        WHERE id = $1
        RETURNING ${PLAN_ITEM_COLUMNS}`,
      [
        id,
        next.kind,
        next.title,
        next.date,
        next.startsAt,
        next.price?.amount ?? null,
        next.price?.currency ?? null,
        next.partnerOfferId,
        next.outboundUrl,
        next.status,
      ],
    );
    return toPlanItem(requireRow(rows[0], 'plan item', id));
  }

  async delete(id: string): Promise<void> {
    await query('DELETE FROM plan_items WHERE id = $1', [id]);
  }
}

interface TripExpenseRow {
  id: string;
  trip_id: string;
  paid_by: string;
  amount: string;
  currency: string;
  description: string;
  expense_date: string;
  split: unknown;
  created_at: Date;
}

const EXPENSE_COLUMNS = `id, trip_id, paid_by, amount, currency, description,
  to_char(expense_date, 'YYYY-MM-DD') AS expense_date, split, created_at`;

function toTripExpense(row: TripExpenseRow): TripExpenseRecord {
  const amount = toMoney(row.amount, row.currency);
  if (!amount) throw new AppError('INTERNAL_ERROR', 'Expense row has no amount');
  return {
    id: row.id,
    tripId: row.trip_id,
    paidBy: row.paid_by,
    amount,
    description: row.description,
    date: row.expense_date,
    split: splitFromJson(row.split, row.currency),
    createdAt: toIso(row.created_at),
  };
}

class PostgresTripExpenseRepository implements TripExpenseRepository {
  async findById(id: string): Promise<TripExpenseRecord | null> {
    const rows = await query<TripExpenseRow>(
      `SELECT ${EXPENSE_COLUMNS} FROM trip_expenses WHERE id = $1`,
      [id],
    );
    return rows[0] ? toTripExpense(rows[0]) : null;
  }

  async listByTrip(tripId: string): Promise<TripExpenseRecord[]> {
    const rows = await query<TripExpenseRow>(
      `SELECT ${EXPENSE_COLUMNS} FROM trip_expenses
        WHERE trip_id = $1 ORDER BY expense_date, created_at, id`,
      [tripId],
    );
    return rows.map(toTripExpense);
  }

  async create(input: Omit<TripExpenseRecord, 'id' | 'createdAt'>): Promise<TripExpenseRecord> {
    const rows = await query<TripExpenseRow>(
      `INSERT INTO trip_expenses
         (trip_id, paid_by, amount, currency, description, expense_date, split)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       RETURNING ${EXPENSE_COLUMNS}`,
      [
        input.tripId,
        input.paidBy,
        input.amount.amount,
        input.amount.currency,
        input.description,
        input.date,
        JSON.stringify(splitToJson(input.split)),
      ],
    );
    return toTripExpense(requireRow(rows[0], 'expense', input.description));
  }

  async update(
    id: string,
    input: Omit<TripExpenseRecord, 'id' | 'tripId' | 'createdAt'>,
  ): Promise<TripExpenseRecord> {
    const rows = await query<TripExpenseRow>(
      `UPDATE trip_expenses
          SET paid_by = $2, amount = $3, currency = $4, description = $5,
              expense_date = $6, split = $7::jsonb
        WHERE id = $1
        RETURNING ${EXPENSE_COLUMNS}`,
      [
        id,
        input.paidBy,
        input.amount.amount,
        input.amount.currency,
        input.description,
        input.date,
        JSON.stringify(splitToJson(input.split)),
      ],
    );
    return toTripExpense(requireRow(rows[0], 'expense', input.description));
  }

  async delete(id: string): Promise<void> {
    await query('DELETE FROM trip_expenses WHERE id = $1', [id]);
  }
}

interface EmergencyContactRow {
  id: string;
  user_id: string;
  name: string;
  phone: string;
  relation: string;
  created_at: Date;
}

const CONTACT_COLUMNS = 'id, user_id, name, phone, relation, created_at';

function toEmergencyContact(row: EmergencyContactRow): EmergencyContactRecord {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    phone: row.phone,
    relation: row.relation,
    createdAt: toIso(row.created_at),
  };
}

class PostgresEmergencyContactRepository implements EmergencyContactRepository {
  async findById(id: string): Promise<EmergencyContactRecord | null> {
    const rows = await query<EmergencyContactRow>(
      `SELECT ${CONTACT_COLUMNS} FROM emergency_contacts WHERE id = $1`,
      [id],
    );
    return rows[0] ? toEmergencyContact(rows[0]) : null;
  }

  async listByUser(userId: string): Promise<EmergencyContactRecord[]> {
    const rows = await query<EmergencyContactRow>(
      `SELECT ${CONTACT_COLUMNS} FROM emergency_contacts
        WHERE user_id = $1 ORDER BY created_at, id`,
      [userId],
    );
    return rows.map(toEmergencyContact);
  }

  async create(
    input: Omit<EmergencyContactRecord, 'id' | 'createdAt'>,
  ): Promise<EmergencyContactRecord> {
    const rows = await query<EmergencyContactRow>(
      `INSERT INTO emergency_contacts (user_id, name, phone, relation)
       VALUES ($1, $2, $3, $4)
       RETURNING ${CONTACT_COLUMNS}`,
      [input.userId, input.name, input.phone, input.relation],
    );
    return toEmergencyContact(requireRow(rows[0], 'emergency contact', input.userId));
  }

  async delete(id: string): Promise<void> {
    await query('DELETE FROM emergency_contacts WHERE id = $1', [id]);
  }
}

/**
 * A connection the server dropped under us (ECONNRESET, "Connection terminated
 * unexpectedly"). Retrying on a fresh pooled connection is safe for the
 * idempotent-or-single-row writes that use it.
 */
export function isConnectionDrop(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && !seen.has(current); depth++) {
    seen.add(current);
    const e = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (e.code === 'ECONNRESET' || e.code === 'EPIPE') return true;
    if (typeof e.message === 'string' && /ECONNRESET|Connection terminated/i.test(e.message)) {
      return true;
    }
    current = e.cause;
  }
  return false;
}

class PostgresProviderRequestRepository implements ProviderRequestRepository {
  async record(entry: Omit<ProviderRequestRecord, 'createdAt'>): Promise<void> {
    const insert = () =>
      query(
        `INSERT INTO provider_requests (provider_id, kind, status, duration_ms, result_count)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          entry.providerId,
          entry.kind,
          entry.status,
          Math.round(entry.durationMs),
          entry.resultCount,
        ],
      );
    try {
      await insert();
    } catch (error) {
      // One retry on a fresh connection; a second failure is reported as before.
      if (!isConnectionDrop(error)) throw error;
      await insert();
    }
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

// --- LiteAPI snapshot -------------------------------------------------------

interface LiteApiRatesDbRow {
  destination_code: string;
  check_in: string;
  check_out: string;
  occupancy_sig: string;
  currency: string;
  guest_nationality: string;
  environment: 'sandbox' | 'production';
  schema_version: number;
  rates: unknown;
  observed_at: Date | string;
  expires_at: Date | string;
  run_id: string;
}

interface LiteApiFlightsDbRow {
  origin: string;
  destination: string;
  departure_date: string;
  return_date: string;
  adults: number;
  currency: string;
  cabin: string;
  offers: unknown;
  observed_at: Date | string;
  expires_at: Date | string;
  environment: 'sandbox' | 'production';
  schema_version: number;
  run_id: string;
}

interface LiteApiRunDbRow {
  run_id: string;
  job: string;
  destination_code: string;
  check_in: string;
  check_out: string;
  environment: 'sandbox' | 'production';
  started_at: Date | string;
  finished_at: Date | string | null;
  calls_made: number;
  status: LiteApiRunRecord['status'];
  error_code: string | null;
}

// Dates leave the database as `YYYY-MM-DD` text, never as a `Date`, so no timezone touches them.
const LITEAPI_RATES_COLUMNS = `destination_code, to_char(check_in, 'YYYY-MM-DD') AS check_in,
  to_char(check_out, 'YYYY-MM-DD') AS check_out, occupancy_sig, currency, guest_nationality,
  environment, schema_version, rates, observed_at, expires_at, run_id`;

const LITEAPI_FLIGHTS_COLUMNS = `origin, destination, to_char(departure_date, 'YYYY-MM-DD') AS departure_date,
  to_char(return_date, 'YYYY-MM-DD') AS return_date, adults, currency, cabin, offers, observed_at,
  expires_at, environment, schema_version, run_id`;

const LITEAPI_RUN_COLUMNS = `run_id, job, destination_code, to_char(check_in, 'YYYY-MM-DD') AS check_in,
  to_char(check_out, 'YYYY-MM-DD') AS check_out, environment, started_at, finished_at,
  calls_made, status, error_code`;

function toLiteApiRun(row: LiteApiRunDbRow): LiteApiRunRecord {
  return {
    runId: row.run_id,
    job: row.job,
    destinationCode: row.destination_code,
    checkIn: row.check_in,
    checkOut: row.check_out,
    environment: row.environment,
    startedAt: toIso(row.started_at),
    finishedAt: toIsoOrNull(row.finished_at),
    callsMade: row.calls_made,
    status: row.status,
    errorCode: row.error_code,
  };
}

interface KiwiOffersDbRow {
  origin: string;
  destination: string;
  departure_date: string;
  return_date: string;
  adults: number;
  currency: string;
  schema_version: number;
  offers: unknown;
  observed_at: Date | string;
}

function kiwiRowFromDb(row: KiwiOffersDbRow): KiwiOffersRow {
  return {
    origin: row.origin,
    destination: row.destination,
    departureDate: row.departure_date,
    returnDate: row.return_date,
    adults: row.adults,
    currency: row.currency,
    schemaVersion: row.schema_version,
    offers: row.offers,
    observedAt: toIso(row.observed_at),
  };
}

interface RouteGraphDbRow {
  origin: string;
  destination: string;
  carrier: string;
  first_seen_at: Date | string;
  last_seen_at: Date | string;
}

class PostgresRouteGraphRepository implements RouteGraphRepository {
  async upsertEdges(edges: readonly RouteGraphEdge[]): Promise<void> {
    for (const edge of edges) {
      await query(
        `INSERT INTO route_graph (origin, destination, carrier, first_seen_at, last_seen_at)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (origin, destination, carrier)
         DO UPDATE SET last_seen_at = GREATEST(route_graph.last_seen_at, EXCLUDED.last_seen_at)`,
        [edge.origin, edge.destination, edge.carrier, edge.firstSeenAt, edge.lastSeenAt],
      );
    }
  }

  async destinationsFor(origin: string): Promise<RouteGraphEdge[]> {
    const rows = await query<RouteGraphDbRow>(
      `SELECT origin, destination, carrier, first_seen_at, last_seen_at
         FROM route_graph WHERE origin = $1 ORDER BY destination, carrier`,
      [origin],
    );
    return rows.map((row) => ({
      origin: row.origin,
      destination: row.destination,
      carrier: row.carrier,
      firstSeenAt: toIso(row.first_seen_at),
      lastSeenAt: toIso(row.last_seen_at),
    }));
  }
}

class PostgresRecommendationListRepository implements RecommendationListRepository {
  async get(key: RecommendationListKey): Promise<RecommendationListRow | null> {
    const rows = await query<{ items: unknown; generated_at: Date | string }>(
      `SELECT items, generated_at FROM recommendation_lists
        WHERE origin = $1 AND date_window = $2 AND adults = $3 AND currency = $4`,
      [key.origin, key.window, key.adults, key.currency],
    );
    const row = rows[0];
    if (!row || !Array.isArray(row.items)) return null;
    return {
      ...key,
      items: row.items as RecommendationListRow['items'],
      generatedAt: toIso(row.generated_at),
    };
  }

  async put(row: RecommendationListRow): Promise<void> {
    await query(
      `INSERT INTO recommendation_lists (origin, date_window, adults, currency, items, generated_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)
       ON CONFLICT (origin, date_window, adults, currency)
       DO UPDATE SET items = EXCLUDED.items, generated_at = EXCLUDED.generated_at`,
      [
        row.origin,
        row.window,
        row.adults,
        row.currency,
        JSON.stringify(row.items),
        row.generatedAt,
      ],
    );
  }
}

interface RouteAggregateDbRow {
  origin: string;
  destination: string;
  month: string;
  currency: string;
  median_minor: string | number;
  min_minor: string | number;
  sample_count: number;
  computed_at: Date | string;
}

interface PriceAlertDbRow {
  id: string;
  watch_id: string;
  route_key: string;
  observation_id: string;
  notification_id: string | null;
  currency: string;
  new_minor: string | number;
  median_minor: string | number;
  created_at: Date | string;
}

function toPriceAlert(row: PriceAlertDbRow): PriceAlertRecord {
  return {
    id: row.id,
    watchId: row.watch_id,
    routeKey: row.route_key,
    observationId: row.observation_id,
    notificationId: row.notification_id,
    currency: row.currency,
    newMinor: Number(row.new_minor),
    medianMinor: Number(row.median_minor),
    createdAt: new Date(row.created_at).toISOString(),
  };
}

const PRICE_ALERT_COLUMNS = `id, watch_id, route_key, observation_id, notification_id, currency,
                             new_minor, median_minor, created_at`;

class PostgresPriceAlertRepository implements PriceAlertRepository {
  async record(input: Omit<PriceAlertRecord, 'id'>): Promise<PriceAlertRecord | null> {
    const rows = await query<PriceAlertDbRow>(
      `INSERT INTO price_alerts
         (watch_id, route_key, observation_id, notification_id, currency, new_minor,
          median_minor, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (watch_id, observation_id) DO NOTHING
       RETURNING ${PRICE_ALERT_COLUMNS}`,
      [
        input.watchId,
        input.routeKey,
        input.observationId,
        input.notificationId,
        input.currency,
        input.newMinor,
        input.medianMinor,
        input.createdAt,
      ],
    );
    return rows[0] ? toPriceAlert(rows[0]) : null;
  }

  async listForRoute(watchId: string, routeKey: string, limit = 50): Promise<PriceAlertRecord[]> {
    const rows = await query<PriceAlertDbRow>(
      `SELECT ${PRICE_ALERT_COLUMNS} FROM price_alerts
        WHERE watch_id = $1 AND route_key = $2
        ORDER BY created_at DESC LIMIT $3`,
      [watchId, routeKey, limit],
    );
    return rows.map(toPriceAlert);
  }
}

class PostgresRouteAggregatesRepository implements RouteAggregatesRepository {
  async write(aggregates: readonly RouteAggregate[]): Promise<void> {
    for (const a of aggregates) {
      // Same merge as `mergeAggregate`: exact min and count, count-weighted median rounded down
      // (BIGINT division truncates, and every value is non-negative).
      await query(
        `INSERT INTO route_aggregates
           (origin, destination, month, currency, median_minor, min_minor, sample_count, computed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (origin, destination, month, currency)
         DO UPDATE SET
           median_minor = (route_aggregates.median_minor * route_aggregates.sample_count
                           + EXCLUDED.median_minor * EXCLUDED.sample_count)
                          / (route_aggregates.sample_count + EXCLUDED.sample_count),
           min_minor = LEAST(route_aggregates.min_minor, EXCLUDED.min_minor),
           sample_count = route_aggregates.sample_count + EXCLUDED.sample_count,
           computed_at = EXCLUDED.computed_at`,
        [
          a.origin,
          a.destination,
          a.month,
          a.currency,
          a.medianMinor,
          a.minMinor,
          a.sampleCount,
          a.computedAt,
        ],
      );
    }
  }

  async list(origin: string, destination: string): Promise<RouteAggregate[]> {
    const rows = await query<RouteAggregateDbRow>(
      `SELECT origin, destination, month, currency, median_minor, min_minor, sample_count,
              computed_at
         FROM route_aggregates WHERE origin = $1 AND destination = $2
        ORDER BY month, currency`,
      [origin, destination],
    );
    return rows.map((row) => ({
      origin: row.origin,
      destination: row.destination,
      month: row.month,
      currency: row.currency,
      medianMinor: Number(row.median_minor),
      minMinor: Number(row.min_minor),
      sampleCount: row.sample_count,
      computedAt: toIso(row.computed_at),
    }));
  }
}

class PostgresKiwiOffersRepository implements KiwiOffersRepository {
  async listDepartingBefore(day: IsoDate): Promise<KiwiOffersRow[]> {
    const rows = await query<KiwiOffersDbRow>(
      `SELECT origin, destination, to_char(departure_date, 'YYYY-MM-DD') AS departure_date,
              to_char(return_date, 'YYYY-MM-DD') AS return_date, adults, currency,
              schema_version, offers, observed_at
         FROM kiwi_offers
        WHERE departure_date < $1::date
        ORDER BY origin, destination, departure_date, return_date`,
      [day],
    );
    return rows.map(kiwiRowFromDb);
  }

  async deleteDepartingBefore(day: IsoDate): Promise<number> {
    const rows = await query<{ deleted: string | number }>(
      `WITH gone AS (DELETE FROM kiwi_offers WHERE departure_date < $1::date RETURNING 1)
       SELECT count(*) AS deleted FROM gone`,
      [day],
    );
    return Number(rows[0]?.deleted ?? 0);
  }

  async get(key: KiwiOffersKey): Promise<KiwiOffersRow | null> {
    const rows = await query<KiwiOffersDbRow>(
      `SELECT origin, destination, to_char(departure_date, 'YYYY-MM-DD') AS departure_date,
              to_char(return_date, 'YYYY-MM-DD') AS return_date, adults, currency,
              schema_version, offers, observed_at
         FROM kiwi_offers
        WHERE origin = $1 AND destination = $2 AND departure_date = $3::date
          AND return_date = $4::date AND adults = $5 AND currency = $6`,
      [key.origin, key.destination, key.departureDate, key.returnDate, key.adults, key.currency],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      origin: row.origin,
      destination: row.destination,
      departureDate: row.departure_date,
      returnDate: row.return_date,
      adults: row.adults,
      currency: row.currency,
      schemaVersion: row.schema_version,
      offers: row.offers,
      observedAt: toIso(row.observed_at),
    };
  }

  async put(row: KiwiOffersRow): Promise<void> {
    await query(
      `INSERT INTO kiwi_offers
         (origin, destination, departure_date, return_date, adults, currency,
          schema_version, offers, observed_at)
       VALUES ($1, $2, $3::date, $4::date, $5, $6, $7, $8::jsonb, $9)
       ON CONFLICT (origin, destination, departure_date, return_date, adults, currency)
       DO UPDATE SET offers = EXCLUDED.offers,
                     schema_version = EXCLUDED.schema_version,
                     observed_at = EXCLUDED.observed_at`,
      [
        row.origin,
        row.destination,
        row.departureDate,
        row.returnDate,
        row.adults,
        row.currency,
        row.schemaVersion,
        JSON.stringify(row.offers),
        row.observedAt,
      ],
    );
  }
}

class PostgresLiteApiSnapshotRepository implements LiteApiSnapshotRepository {
  constructor(private readonly clock: () => number) {}

  private nowIso(): string {
    return new Date(this.clock()).toISOString();
  }

  async getRates(key: LiteApiRatesKey): Promise<LiteApiRatesRow | null> {
    const rows = await query<LiteApiRatesDbRow>(
      `SELECT ${LITEAPI_RATES_COLUMNS} FROM liteapi_rates_snapshot
        WHERE destination_code = $1 AND check_in = $2::date AND check_out = $3::date
          AND occupancy_sig = $4 AND currency = $5 AND guest_nationality = $6
          AND expires_at > $7`,
      [
        key.destinationCode,
        key.checkIn,
        key.checkOut,
        key.occupancySig,
        key.currency,
        key.guestNationality,
        this.nowIso(),
      ],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      destinationCode: row.destination_code,
      checkIn: row.check_in,
      checkOut: row.check_out,
      occupancySig: row.occupancy_sig,
      currency: row.currency,
      guestNationality: row.guest_nationality,
      environment: row.environment,
      schemaVersion: row.schema_version,
      rates: row.rates,
      observedAt: toIso(row.observed_at),
      expiresAt: toIso(row.expires_at),
      runId: row.run_id,
    };
  }

  async recentRates(input: {
    readonly environment: LiteApiEnvironment;
    readonly limit: number;
  }): Promise<LiteApiRatesRow[]> {
    const limit = Math.min(12, Math.max(1, Math.trunc(input.limit) || 1));
    const rows = await query<LiteApiRatesDbRow>(
      `SELECT ${LITEAPI_RATES_COLUMNS} FROM liteapi_rates_snapshot
        WHERE environment = $1 AND expires_at > $2
        ORDER BY observed_at DESC
        LIMIT $3`,
      [input.environment, this.nowIso(), limit],
    );
    return rows.map((row) => ({
      destinationCode: row.destination_code,
      checkIn: row.check_in,
      checkOut: row.check_out,
      occupancySig: row.occupancy_sig,
      currency: row.currency,
      guestNationality: row.guest_nationality,
      environment: row.environment,
      schemaVersion: row.schema_version,
      rates: row.rates,
      observedAt: toIso(row.observed_at),
      expiresAt: toIso(row.expires_at),
      runId: row.run_id,
    }));
  }

  async getFlights(key: LiteApiFlightsKey): Promise<LiteApiFlightsRow | null> {
    const rows = await query<LiteApiFlightsDbRow>(
      `SELECT ${LITEAPI_FLIGHTS_COLUMNS} FROM liteapi_flights_snapshot
        WHERE origin = $1 AND destination = $2 AND departure_date = $3::date
          AND return_date = $4::date AND adults = $5 AND currency = $6 AND cabin = $7
          AND expires_at > $8`,
      [
        key.origin,
        key.destination,
        key.departureDate,
        key.returnDate,
        key.adults,
        key.currency,
        key.cabin,
        this.nowIso(),
      ],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      origin: row.origin,
      destination: row.destination,
      departureDate: row.departure_date,
      returnDate: row.return_date,
      adults: row.adults,
      currency: row.currency,
      cabin: row.cabin,
      environment: row.environment,
      schemaVersion: row.schema_version,
      offers: row.offers,
      observedAt: toIso(row.observed_at),
      expiresAt: toIso(row.expires_at),
      runId: row.run_id,
    };
  }

  async putFlights(row: LiteApiFlightsRow): Promise<void> {
    await query(
      `INSERT INTO liteapi_flights_snapshot
         (origin, destination, departure_date, return_date, adults, currency, cabin,
          offers, observed_at, expires_at, environment, schema_version, run_id)
       VALUES ($1, $2, $3::date, $4::date, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13)
       ON CONFLICT (origin, destination, departure_date, return_date, adults, currency, cabin)
       DO UPDATE SET offers = EXCLUDED.offers,
                     observed_at = EXCLUDED.observed_at,
                     expires_at = EXCLUDED.expires_at,
                     environment = EXCLUDED.environment,
                     schema_version = EXCLUDED.schema_version,
                     run_id = EXCLUDED.run_id`,
      [
        row.origin,
        row.destination,
        row.departureDate,
        row.returnDate,
        row.adults,
        row.currency,
        row.cabin,
        JSON.stringify(row.offers),
        row.observedAt,
        row.expiresAt,
        row.environment,
        row.schemaVersion,
        row.runId,
      ],
    );
    await this.sweep();
  }

  async getHotels(destinationCode: string): Promise<LiteApiHotelRow[]> {
    const rows = await query<{
      hotel_id: string;
      destination_code: string;
      content: unknown;
      fetched_at: Date | string;
      expires_at: Date | string;
    }>(
      `SELECT hotel_id, destination_code, content, fetched_at, expires_at FROM liteapi_hotels
        WHERE destination_code = $1 AND expires_at > $2 ORDER BY hotel_id`,
      [destinationCode, this.nowIso()],
    );
    return rows.map((row) => ({
      hotelId: row.hotel_id,
      destinationCode: row.destination_code,
      content: row.content,
      fetchedAt: toIso(row.fetched_at),
      expiresAt: toIso(row.expires_at),
    }));
  }

  async putRates(row: LiteApiRatesRow): Promise<void> {
    await query(
      `INSERT INTO liteapi_rates_snapshot
         (destination_code, check_in, check_out, occupancy_sig, currency, guest_nationality,
          environment, schema_version, rates, observed_at, expires_at, run_id)
       VALUES ($1, $2::date, $3::date, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12)
       ON CONFLICT (destination_code, check_in, check_out, occupancy_sig, currency, guest_nationality)
       DO UPDATE SET environment = EXCLUDED.environment,
                     schema_version = EXCLUDED.schema_version,
                     rates = EXCLUDED.rates,
                     observed_at = EXCLUDED.observed_at,
                     expires_at = EXCLUDED.expires_at,
                     run_id = EXCLUDED.run_id`,
      [
        row.destinationCode,
        row.checkIn,
        row.checkOut,
        row.occupancySig,
        row.currency,
        row.guestNationality,
        row.environment,
        row.schemaVersion,
        JSON.stringify(row.rates),
        row.observedAt,
        row.expiresAt,
        row.runId,
      ],
    );
    await this.sweep();
  }

  async putHotels(rows: readonly LiteApiHotelRow[]): Promise<void> {
    for (const row of rows) {
      await query(
        `INSERT INTO liteapi_hotels (hotel_id, destination_code, content, fetched_at, expires_at)
         VALUES ($1, $2, $3::jsonb, $4, $5)
         ON CONFLICT (hotel_id)
         DO UPDATE SET destination_code = EXCLUDED.destination_code,
                       content = EXCLUDED.content,
                       fetched_at = EXCLUDED.fetched_at,
                       expires_at = EXCLUDED.expires_at`,
        [
          row.hotelId,
          row.destinationCode,
          JSON.stringify(row.content),
          row.fetchedAt,
          row.expiresAt,
        ],
      );
    }
    await this.sweep();
  }

  private async sweep(): Promise<void> {
    const at = this.nowIso();
    await query('DELETE FROM liteapi_rates_snapshot WHERE expires_at <= $1', [at]);
    await query('DELETE FROM liteapi_hotels WHERE expires_at <= $1', [at]);
    await query('DELETE FROM liteapi_flights_snapshot WHERE expires_at <= $1', [at]);
  }

  async startRun(input: LiteApiRunStart): Promise<LiteApiRunRecord> {
    const rows = await query<LiteApiRunDbRow>(
      `INSERT INTO liteapi_refresh_runs
         (run_id, job, destination_code, check_in, check_out, environment, started_at, status)
       VALUES ($1, $2, $3, $4::date, $5::date, $6, $7, 'running')
       RETURNING ${LITEAPI_RUN_COLUMNS}`,
      [
        input.runId,
        input.job,
        input.destinationCode,
        input.checkIn,
        input.checkOut,
        input.environment,
        this.nowIso(),
      ],
    );
    return toLiteApiRun(rows[0]!);
  }

  async finishRun(runId: string, result: LiteApiRunFinish): Promise<void> {
    const rows = await query<{ run_id: string }>(
      `UPDATE liteapi_refresh_runs
          SET status = $2, calls_made = $3, error_code = $4, finished_at = $5
        WHERE run_id = $1 RETURNING run_id`,
      [runId, result.status, result.callsMade, result.errorCode ?? null, this.nowIso()],
    );
    requireRow(rows[0], 'LiteAPI run', runId);
  }

  async latestRun(job?: string): Promise<LiteApiRunRecord | null> {
    const rows = await query<LiteApiRunDbRow>(
      `SELECT ${LITEAPI_RUN_COLUMNS} FROM liteapi_refresh_runs
        WHERE status <> 'disabled' AND ($1::text IS NULL OR job = $1)
        ORDER BY started_at DESC LIMIT 1`,
      [job ?? null],
    );
    return rows[0] ? toLiteApiRun(rows[0]) : null;
  }

  async callsSince(since: IsoDateTime, job?: string): Promise<number> {
    const rows = await query<{ calls: string | null }>(
      `SELECT COALESCE(SUM(calls_made), 0) AS calls FROM liteapi_refresh_runs
        WHERE started_at >= $1 AND ($2::text IS NULL OR job = $2)`,
      [since, job ?? null],
    );
    return Number(rows[0]?.calls ?? 0);
  }
}

interface VisitorSearchDbRow {
  destination_code: string;
  check_in: string;
  check_out: string;
  party_size: number;
  currency: string;
  searched_at: Date | string;
}

class PostgresVisitorSearchRepository implements VisitorSearchRepository {
  constructor(private readonly clock: () => number) {}

  async record(input: VisitorSearchInput): Promise<boolean> {
    const now = this.clock();
    const rows = await query<{ destination_code: string }>(
      `INSERT INTO visitor_searches
         (destination_code, check_in, check_out, party_size, currency, dedupe_key, searched_at)
       SELECT $1::text, $2::date, $3::date, $4::int, $5::text, $6::text, $7::timestamptz
        WHERE NOT EXISTS (
          SELECT 1 FROM visitor_searches WHERE dedupe_key = $6::text AND searched_at > $8::timestamptz
        )
       RETURNING destination_code`,
      [
        input.destinationCode,
        input.checkIn,
        input.checkOut,
        input.partySize,
        input.currency,
        input.dedupeKey,
        new Date(now).toISOString(),
        new Date(now - VISITOR_SEARCH_DEDUPE_MS).toISOString(),
      ],
    );
    return rows.length > 0;
  }

  async listRecent(input: {
    readonly destinationCodes?: readonly string[];
    readonly limit: number;
  }): Promise<VisitorSearchRecord[]> {
    const limit = Math.min(200, Math.max(1, Math.trunc(input.limit) || 1));
    const since = new Date(this.clock() - VISITOR_SEARCH_WINDOW_MS).toISOString();
    const rows = await query<VisitorSearchDbRow>(
      `SELECT destination_code, check_in::text AS check_in, check_out::text AS check_out,
              party_size, currency, searched_at
         FROM visitor_searches
        WHERE searched_at >= $1 AND ($2::text[] IS NULL OR destination_code = ANY($2::text[]))
        ORDER BY searched_at DESC
        LIMIT $3`,
      [since, input.destinationCodes ? [...input.destinationCodes] : null, limit],
    );
    return rows.map((row) => ({
      destinationCode: row.destination_code,
      checkIn: row.check_in as IsoDate,
      checkOut: row.check_out as IsoDate,
      partySize: row.party_size,
      currency: row.currency,
      searchedAt: toIso(row.searched_at),
    }));
  }
}

/** The Postgres-backed persistence surface. */
export function createPostgresRepositories(options: RepositoryOptions = {}): Repositories {
  return {
    liteapiSnapshot: new PostgresLiteApiSnapshotRepository(options.now ?? Date.now),
    kiwiOffers: new PostgresKiwiOffersRepository(),
    routeGraph: new PostgresRouteGraphRepository(),
    recommendationLists: new PostgresRecommendationListRepository(),
    routeAggregates: new PostgresRouteAggregatesRepository(),
    priceAlerts: new PostgresPriceAlertRepository(),
    visitorSearches: new PostgresVisitorSearchRepository(options.now ?? Date.now),
    users: new PostgresUserRepository(),
    credentials: new PostgresUserCredentialRepository(),
    sessions: new PostgresSessionRepository(),
    emailVerification: new PostgresEmailVerificationRepository(),
    passwordReset: new PostgresPasswordResetRepository(),
    emailChange: new PostgresEmailChangeRepository(),
    preferences: new PostgresUserPreferencesRepository(),
    alertPreferences: new PostgresAlertPreferencesRepository(),
    tripSearches: new PostgresTripSearchRepository(),
    travelWatches: new PostgresTravelWatchRepository(),
    priceHistory: new PostgresPriceHistoryRepository(),
    notifications: new PostgresNotificationRepository(),
    pushSubscriptions: new PostgresPushSubscriptionRepository(),
    providerRequests: new PostgresProviderRequestRepository(),
    trips: new PostgresTripRepository(),
    tripInvites: new PostgresTripInviteRepository(),
    planItems: new PostgresPlanItemRepository(),
    tripExpenses: new PostgresTripExpenseRepository(),
    emergencyContacts: new PostgresEmergencyContactRepository(),
    backend: 'postgres',
  };
}
