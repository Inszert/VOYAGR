-- Shared cache entries in Postgres: the database tier of the cache.
--
-- Additive only: one new table, nothing existing is altered. Used when
-- DATABASE_URL is set and REDIS_URL is not (see src/cache/index.ts), so a
-- trip search served to one visitor is served from storage to the next one,
-- across instances and restarts, for as long as the entry is fresh.
--
-- Holds only search and discovery results that are already schema-checked
-- and derived from core output. No personal data, no credentials.
-- An entry past expires_at is a miss; expired rows are removed on write.

BEGIN;

CREATE TABLE IF NOT EXISTS cache_entries (
  cache_key   TEXT PRIMARY KEY,
  payload     JSONB NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS cache_entries_expires_idx ON cache_entries (expires_at);

COMMIT;
