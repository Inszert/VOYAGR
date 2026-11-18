-- Visitor searches: what visitors search for, so the stays recommendations can follow real
-- demand. One row per distinct search; the same visitor repeating a search within ten minutes
-- is not stored twice.
--
-- No personal data: no name, no email, no IP address. `dedupe_key` is a one-way hash of the
-- search and a coarse request signature (it is never reversed, and never joined to a user).
-- Additive only: one new table and one index.

BEGIN;

CREATE TABLE IF NOT EXISTS visitor_searches (
  id               BIGSERIAL PRIMARY KEY,
  destination_code TEXT NOT NULL,
  check_in         DATE NOT NULL,
  check_out        DATE NOT NULL,
  party_size       INTEGER NOT NULL,
  currency         CHAR(3) NOT NULL,
  dedupe_key       TEXT NOT NULL,
  searched_at      TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS visitor_searches_destination_time_idx
  ON visitor_searches (destination_code, searched_at DESC);

CREATE INDEX IF NOT EXISTS visitor_searches_dedupe_idx
  ON visitor_searches (dedupe_key, searched_at DESC);

COMMIT;
