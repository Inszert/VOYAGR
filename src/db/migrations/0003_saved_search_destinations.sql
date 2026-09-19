-- Saved searches remember their destinations
--
-- Phase 1.5. A `SearchProfile` says what kind of trip the user wants - budget,
-- dates, party, style - but not where. Destinations live on the request, so a
-- saved search without them cannot be replayed, and a Travel Watch that cannot
-- replay its own search is not a watch.
--
-- Stored as a column rather than folded into the profile JSONB: they are a
-- first-class part of what was asked for, and a column can be indexed, checked
-- and read without parsing a blob.

BEGIN;

ALTER TABLE trip_searches
  ADD COLUMN IF NOT EXISTS destinations TEXT[] NOT NULL DEFAULT '{}';

-- A search with no destination matches nothing and would run forever finding it.
ALTER TABLE trip_searches
  DROP CONSTRAINT IF EXISTS trip_searches_have_destinations;

ALTER TABLE trip_searches
  ADD CONSTRAINT trip_searches_have_destinations
  CHECK (cardinality(destinations) > 0);

COMMIT;
