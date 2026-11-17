-- A day-by-day plan on the trip hub's own plan items.
--
-- Additive only: two nullable-or-defaulted columns on plan_items. An item with
-- a NULL plan_day is an ordinary idea on the trip, as before; an item with a
-- plan_day is a stop on that day of the traveller's own plan, ordered within
-- the day by plan_position (0 is first). No money here.

BEGIN;

ALTER TABLE plan_items
  ADD COLUMN IF NOT EXISTS plan_day      INTEGER,
  ADD COLUMN IF NOT EXISTS plan_position INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'plan_items_plan_day_range') THEN
    ALTER TABLE plan_items
      ADD CONSTRAINT plan_items_plan_day_range
      CHECK (plan_day IS NULL OR (plan_day BETWEEN 1 AND 60));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS plan_items_trip_day_idx
  ON plan_items (trip_id, plan_day, plan_position)
  WHERE plan_day IS NOT NULL;

COMMIT;
