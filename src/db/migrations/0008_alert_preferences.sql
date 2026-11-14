-- Which price-drop alerts a user wants, and about where.
--
-- A typed table rather than another key in user_preferences.explicit: the
-- alert filter reads it on every watch refresh, and the budget is integer
-- minor units with its currency beside it, never a float inside JSON. A user
-- with no row gets every alert, as before; the row only narrows.

BEGIN;

CREATE TABLE IF NOT EXISTS alert_preferences (
  user_id             UUID PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  home_airport        CHAR(3),
  destinations        TEXT[] NOT NULL DEFAULT '{}',
  budget_amount       BIGINT,
  budget_currency     CHAR(3),
  earliest_departure  DATE,
  latest_departure    DATE,
  price_drop_alerts   BOOLEAN NOT NULL DEFAULT true,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT alert_preferences_budget_pair
    CHECK ((budget_amount IS NULL) = (budget_currency IS NULL))
);

COMMIT;
