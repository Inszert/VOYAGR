-- Price-drop alert log (slice 5).
--
-- One row per alert raised: which watch, which route and month bucket, which observation caused
-- it, and the notification that carries it. The unique key makes "never twice for the same
-- observation" hold even if two requests race. Additive only: one new table.

BEGIN;

CREATE TABLE IF NOT EXISTS price_alerts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  watch_id        UUID NOT NULL REFERENCES travel_watches (id) ON DELETE CASCADE,
  route_key       TEXT NOT NULL,
  observation_id  TEXT NOT NULL,
  notification_id UUID REFERENCES notifications (id) ON DELETE SET NULL,
  currency        CHAR(3) NOT NULL,
  new_minor       BIGINT NOT NULL,
  median_minor    BIGINT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (watch_id, observation_id)
);

CREATE INDEX IF NOT EXISTS price_alerts_watch_route_idx
  ON price_alerts (watch_id, route_key, created_at DESC);

COMMIT;
