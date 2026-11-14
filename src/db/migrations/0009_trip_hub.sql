-- The trip hub: a plan, shared expenses and the traveller's own emergency contacts.
--
-- Additive only: five new tables, nothing existing is altered.
--
-- Money convention as everywhere else: BIGINT minor units beside an ISO 4217
-- code, never a float. A plan item's price is what the user typed in; it is
-- not read from a partner.
--
-- Personal data here: trip_members.name, emergency_contacts.* and the
-- user-entered text on a trip. Erasing a user removes the trips they own
-- (cascade), their contacts (cascade), and strips their name from any seat
-- they held on someone else's trip (see PostgresUserRepository.erase).

BEGIN;

CREATE TABLE IF NOT EXISTS trips (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id             UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name                 TEXT NOT NULL,
  destination          TEXT NOT NULL,
  destination_country  CHAR(2),
  start_date           DATE,
  end_date             DATE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT trips_dates_ordered
    CHECK (start_date IS NULL OR end_date IS NULL OR end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS trips_owner_idx ON trips (owner_id);

-- A member without an account has a NULL user_id. SET NULL rather than CASCADE
-- on the user: another person's trip keeps its ledger when one member leaves
-- Voyagr, and the name is blanked by the erase path.
CREATE TABLE IF NOT EXISTS trip_members (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id     UUID NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
  user_id     UUID REFERENCES users (id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS trip_members_trip_user_idx
  ON trip_members (trip_id, user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS trip_members_user_idx ON trip_members (user_id);

CREATE TABLE IF NOT EXISTS plan_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id           UUID NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
  kind              TEXT NOT NULL
    CHECK (kind IN ('flight', 'stay', 'transfer', 'activity', 'esim', 'insurance', 'other')),
  title             TEXT NOT NULL,
  item_date         DATE,
  -- A wall-clock time with no zone, stored as the text the domain type is.
  starts_at         TEXT,
  price_amount      BIGINT,
  price_currency    CHAR(3),
  partner_offer_id  TEXT,
  outbound_url      TEXT,
  -- 'booked' is only ever written when the user says so.
  status            TEXT NOT NULL DEFAULT 'idea' CHECK (status IN ('idea', 'planned', 'booked')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT plan_items_price_pair CHECK ((price_amount IS NULL) = (price_currency IS NULL))
);

CREATE INDEX IF NOT EXISTS plan_items_trip_idx ON plan_items (trip_id);

CREATE TABLE IF NOT EXISTS trip_expenses (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id       UUID NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
  paid_by       UUID NOT NULL REFERENCES trip_members (id),
  amount        BIGINT NOT NULL CHECK (amount > 0),
  currency      CHAR(3) NOT NULL,
  description   TEXT NOT NULL,
  expense_date  DATE NOT NULL,
  -- {kind, ...} with member ids and integer weights or minor-unit amounts.
  split         JSONB NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trip_expenses_trip_idx ON trip_expenses (trip_id);

CREATE TABLE IF NOT EXISTS emergency_contacts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  phone       TEXT NOT NULL,
  relation    TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS emergency_contacts_user_idx ON emergency_contacts (user_id);

COMMIT;
