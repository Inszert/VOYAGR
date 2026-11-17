-- Trip invite links: the owner makes a link, anyone who opens it and signs in joins as a member.
--
-- Additive only: one new table, nothing existing is altered.
--
-- Only a SHA-256 hash of the 32-byte random token is stored, never the token,
-- so a database read cannot be turned into a working link. A link is good for
-- 14 days, until revoked, and for at most max_uses people (the count is taken
-- atomically in one UPDATE, see PostgresTripInviteRepository.claim).
-- Deleting the trip or the user who made the link removes it.

BEGIN;

CREATE TABLE IF NOT EXISTS trip_invites (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id     UUID NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  created_by  UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  uses        INTEGER NOT NULL DEFAULT 0 CHECK (uses >= 0),
  max_uses    INTEGER NOT NULL DEFAULT 10 CHECK (max_uses >= 1)
);

CREATE INDEX IF NOT EXISTS trip_invites_trip_idx ON trip_invites (trip_id);

COMMIT;
