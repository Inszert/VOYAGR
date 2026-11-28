-- Stored recommendation lists (lazy recommendations slice).
--
-- One row per origin, date window, party size and currency: the list the app shows at once while
-- a refresh runs. generated_at is when the MCP answered; a list older than 12 h is refreshed only
-- when the app is open. Additive only.

BEGIN;

CREATE TABLE IF NOT EXISTS recommendation_lists (
  origin       TEXT NOT NULL,
  date_window  TEXT NOT NULL,
  adults       INTEGER NOT NULL,
  currency     CHAR(3) NOT NULL,
  items        JSONB NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (origin, date_window, adults, currency)
);

COMMIT;
