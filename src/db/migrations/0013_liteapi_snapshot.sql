-- LiteAPI snapshot: our own copy of hotel content and rates, refreshed by the worker on a
-- schedule. Visitors read these tables; they never cause a vendor call.
--
-- Additive only: three new tables, nothing existing is altered.
--
-- Rates are one JSONB column on purpose: a page reads a whole destination-and-window answer,
-- nothing queries inside a rate, and the stored shape is still changing. `schema_version` lets
-- the reader reject a row written under an older shape. Money inside is
-- { amount, currency } with integer minor units.
--
-- `liteapi_refresh_runs` is the audit trail and the real call counter: `calls_made` is summed
-- against the daily ceiling. `error_code` is an ErrorCode only, never a message, never a key.

BEGIN;

CREATE TABLE IF NOT EXISTS liteapi_hotels (
  hotel_id         TEXT PRIMARY KEY,
  destination_code TEXT NOT NULL,
  content          JSONB NOT NULL,
  fetched_at       TIMESTAMPTZ NOT NULL,
  expires_at       TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS liteapi_hotels_destination_idx
  ON liteapi_hotels (destination_code, expires_at);

CREATE TABLE IF NOT EXISTS liteapi_rates_snapshot (
  destination_code  TEXT NOT NULL,
  check_in          DATE NOT NULL,
  check_out         DATE NOT NULL,
  occupancy_sig     TEXT NOT NULL,
  currency          CHAR(3) NOT NULL,
  guest_nationality CHAR(2) NOT NULL,
  environment       TEXT NOT NULL CHECK (environment IN ('sandbox', 'production')),
  schema_version    INTEGER NOT NULL,
  rates             JSONB NOT NULL,
  observed_at       TIMESTAMPTZ NOT NULL,
  expires_at        TIMESTAMPTZ NOT NULL,
  run_id            TEXT NOT NULL,
  PRIMARY KEY (destination_code, check_in, check_out, occupancy_sig, currency, guest_nationality)
);

CREATE INDEX IF NOT EXISTS liteapi_rates_snapshot_expires_idx
  ON liteapi_rates_snapshot (expires_at);

CREATE TABLE IF NOT EXISTS liteapi_refresh_runs (
  run_id           TEXT PRIMARY KEY,
  job              TEXT NOT NULL,
  destination_code TEXT NOT NULL,
  check_in         DATE NOT NULL,
  check_out        DATE NOT NULL,
  environment      TEXT NOT NULL CHECK (environment IN ('sandbox', 'production')),
  started_at       TIMESTAMPTZ NOT NULL,
  finished_at      TIMESTAMPTZ,
  calls_made       INTEGER NOT NULL DEFAULT 0,
  status           TEXT NOT NULL
                   CHECK (status IN ('running', 'ok', 'failed', 'skipped_cap', 'disabled')),
  error_code       TEXT
);

CREATE INDEX IF NOT EXISTS liteapi_refresh_runs_window_idx
  ON liteapi_refresh_runs (destination_code, check_in, check_out, started_at DESC);

CREATE INDEX IF NOT EXISTS liteapi_refresh_runs_started_idx
  ON liteapi_refresh_runs (started_at);

COMMIT;
