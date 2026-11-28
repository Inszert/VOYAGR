-- Kiwi MCP offers: the durable copy behind the 12-hour read path. A lookup that finds no fresh
-- cache entry reads this row; when the MCP then fails, an old row is served, labelled with its
-- age. So a row is never expired by the database: the nightly past-departure cleanup (not built
-- yet) is the only thing that deletes.
--
-- Additive only: one new table and one index. Offers are one JSONB column (nothing queries
-- inside them); `schema_version` lets the reader reject a row written under an older shape.

BEGIN;

CREATE TABLE IF NOT EXISTS kiwi_offers (
  origin         TEXT NOT NULL,
  destination    TEXT NOT NULL,
  departure_date DATE NOT NULL,
  return_date    DATE NOT NULL,
  adults         INTEGER NOT NULL,
  currency       CHAR(3) NOT NULL,
  schema_version INTEGER NOT NULL,
  offers         JSONB NOT NULL,
  observed_at    TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (origin, destination, departure_date, return_date, adults, currency)
);

CREATE INDEX IF NOT EXISTS kiwi_offers_departure_idx ON kiwi_offers (departure_date);

COMMIT;
