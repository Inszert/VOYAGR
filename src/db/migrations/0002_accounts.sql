-- Voyagr accounts: plans, credentials and sessions
--
-- Phase 1.3. Adds what authentication needs on top of 0001's users and
-- user_preferences tables.
--
-- Two separations are deliberate and should survive any later tidy-up:
--   * Password material lives in its own table, not a column on users. A user
--     row is read on every request and handed to feature code; a password hash
--     has no business travelling with it.
--   * Sessions store the SHA-256 of a token, never the token. A dump of this
--     table therefore grants nobody a session.

BEGIN;

-- --------------------------------------------------------------------------
-- Plans
-- --------------------------------------------------------------------------

-- Entitlements are resolved in code (src/core/entitlements.ts), not stored as
-- columns: the limits belong with the logic that applies them, and a plan is
-- meaningless to the database beyond being a label. Adding a paid tier is a new
-- value here plus a new row in that table.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS plan TEXT NOT NULL DEFAULT 'free';

-- --------------------------------------------------------------------------
-- Credentials
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS user_credentials (
  user_id        UUID PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  -- Self-describing: algorithm and cost parameters travel with the hash, so
  -- raising the cost later does not invalidate existing passwords.
  -- Format: scrypt$N$r$p$salt$hash, base64url throughout.
  password_hash  TEXT NOT NULL,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- --------------------------------------------------------------------------
-- Sessions
-- --------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- SHA-256 of the session token, hex encoded. Never the token itself.
  token_hash  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL
);

-- Every request authenticates by this lookup, so it is the hot path.
CREATE UNIQUE INDEX IF NOT EXISTS sessions_token_hash_idx ON sessions (token_hash);

-- "Sign out everywhere", and the cascade after a password change.
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);

-- Housekeeping sweeps expired sessions by this.
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions (expires_at);

COMMIT;
