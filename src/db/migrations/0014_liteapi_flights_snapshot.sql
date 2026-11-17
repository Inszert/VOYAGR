-- LiteAPI flights snapshot: our own copy of round-trip flight offers, refreshed by the worker on
-- a schedule (`liteapi.flights.refresh`). Visitors read this table; they never cause a vendor
-- call.
--
-- Additive only: one new table. Run records reuse `liteapi_refresh_runs` (migration 0013), with
-- the job name `liteapi.flights.refresh` and `destination_code` holding `ORIGIN-DESTINATION`.
--
-- `offers` is one JSONB column on purpose, like `rates` in 0013: a page reads a whole route and
-- window, nothing queries inside an offer, and the stored shape is still changing.
-- `schema_version` lets the reader reject a row written under an older shape. Money inside is
-- { amount, currency } with integer minor units. Each offer carries its own vendor
-- `expiresAt`; the reader never shows an offer past it.

BEGIN;

CREATE TABLE IF NOT EXISTS liteapi_flights_snapshot (
  origin         TEXT NOT NULL,
  destination    TEXT NOT NULL,
  departure_date DATE NOT NULL,
  return_date    DATE NOT NULL,
  adults         INTEGER NOT NULL,
  currency       CHAR(3) NOT NULL,
  cabin          TEXT NOT NULL,
  offers         JSONB NOT NULL,
  observed_at    TIMESTAMPTZ NOT NULL,
  expires_at     TIMESTAMPTZ NOT NULL,
  environment    TEXT NOT NULL CHECK (environment IN ('sandbox', 'production')),
  schema_version INTEGER NOT NULL,
  run_id         TEXT NOT NULL,
  PRIMARY KEY (origin, destination, departure_date, return_date, adults, currency, cabin)
);

CREATE INDEX IF NOT EXISTS liteapi_flights_snapshot_expires_idx
  ON liteapi_flights_snapshot (expires_at);

COMMIT;
