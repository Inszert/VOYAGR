-- Voyagr initial schema
--
-- Covers the entities the Phase 1 loop needs (specification section 21):
-- search -> complete-trip cost -> ranking -> saved watch -> monitoring -> alert.
-- The remaining entities land with the features that use them.
--
-- Not applied automatically. Run with `npm run db:migrate` once DATABASE_URL
-- points at a Postgres instance. The foundation runs without it.
--
-- Money convention: every amount is stored as an integer in the currency's
-- minor unit alongside its ISO 4217 code, matching `src/core/money.ts`.
-- No FLOAT, NUMERIC or DOUBLE PRECISION is used for money anywhere.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- --------------------------------------------------------------------------
-- Users and preferences
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Case-insensitive uniqueness without depending on the citext extension.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx ON users (lower(email));

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id     UUID PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  -- Explicit preferences the user set, and inferred ones the system learned,
  -- kept apart so section 31.7 transparency is possible at all.
  explicit    JSONB NOT NULL DEFAULT '{}'::jsonb,
  inferred    JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- --------------------------------------------------------------------------
-- Saved searches and watches
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS trip_searches (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  -- The validated SearchProfile. Stored whole so a watch always replays the
  -- exact constraints it was created with.
  profile     JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trip_searches_user_idx ON trip_searches (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS travel_watches (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  trip_search_id        UUID NOT NULL REFERENCES trip_searches (id) ON DELETE CASCADE,
  status                TEXT NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'paused', 'archived')),
  priority              TEXT NOT NULL DEFAULT 'normal'
                          CHECK (priority IN ('normal', 'high')),
  last_run_at           TIMESTAMPTZ,
  next_run_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  best_known_total      BIGINT,
  best_known_currency   CHAR(3),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT best_known_total_has_currency
    CHECK ((best_known_total IS NULL) = (best_known_currency IS NULL))
);

-- The scheduler's hot path: "which active watches are due?".
CREATE INDEX IF NOT EXISTS travel_watches_due_idx
  ON travel_watches (next_run_at)
  WHERE status = 'active';

-- --------------------------------------------------------------------------
-- Observations and price history
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS price_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  watch_id        UUID NOT NULL REFERENCES travel_watches (id) ON DELETE CASCADE,
  component_type  TEXT NOT NULL
                    CHECK (component_type IN ('flight', 'hotel', 'transfer', 'trip_total')),
  component_id    TEXT NOT NULL,
  amount          BIGINT NOT NULL,
  currency        CHAR(3) NOT NULL,
  -- Provenance is mandatory: a price with no source and timestamp cannot
  -- honestly be shown to a user (section 22).
  provider_id     TEXT NOT NULL,
  observed_at     TIMESTAMPTZ NOT NULL,
  conditions      TEXT
);

CREATE INDEX IF NOT EXISTS price_history_watch_idx
  ON price_history (watch_id, component_type, observed_at DESC);

-- --------------------------------------------------------------------------
-- Notifications
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS notifications (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  watch_id      UUID REFERENCES travel_watches (id) ON DELETE SET NULL,
  severity      TEXT NOT NULL CHECK (severity IN ('important', 'interesting', 'fyi')),
  title         TEXT NOT NULL,
  body          TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  delivered_at  TIMESTAMPTZ,
  read_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  endpoint    TEXT NOT NULL UNIQUE,
  -- Subscription keys are credentials: never logged, never returned to a client
  -- other than the one that created them.
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON push_subscriptions (user_id);

-- --------------------------------------------------------------------------
-- Provider observability
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS provider_requests (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider_id   TEXT NOT NULL,
  kind          TEXT NOT NULL,
  request_id    TEXT,
  status        TEXT NOT NULL CHECK (status IN ('ok', 'error', 'timeout', 'rate_limited')),
  duration_ms   INTEGER NOT NULL,
  result_count  INTEGER,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS provider_requests_provider_idx
  ON provider_requests (provider_id, created_at DESC);

COMMIT;
