-- Route graph and route aggregates (nightly-cleanup slice).
--
-- route_graph answers "who flies from where to where": one row per origin, destination and
-- carrier, with the first and last day we saw it. It holds no price and no date of travel, so
-- the past-departure cleanup never deletes from it.
--
-- route_aggregates is what survives the cleanup: per route, month of departure and currency, the
-- median and minimum of the cheapest price per stored lookup, and how many lookups that was.
-- It is the baseline for price-drop alerts after the offers themselves are gone.
--
-- Additive only: two new tables.

BEGIN;

CREATE TABLE IF NOT EXISTS route_graph (
  origin        TEXT NOT NULL,
  destination   TEXT NOT NULL,
  carrier       TEXT NOT NULL,
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_at  TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (origin, destination, carrier)
);

CREATE INDEX IF NOT EXISTS route_graph_origin_idx ON route_graph (origin);

CREATE TABLE IF NOT EXISTS route_aggregates (
  origin       TEXT NOT NULL,
  destination  TEXT NOT NULL,
  month        CHAR(7) NOT NULL,
  currency     CHAR(3) NOT NULL,
  median_minor BIGINT NOT NULL,
  min_minor    BIGINT NOT NULL,
  sample_count INTEGER NOT NULL,
  computed_at  TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (origin, destination, month, currency)
);

COMMIT;
