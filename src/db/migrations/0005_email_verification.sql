-- Email verification.
--
-- Same shape as sessions (0002_accounts.sql) and for the same reason: the
-- database stores only the SHA-256 of the token that goes in the email link,
-- never the token itself, so a dump of this table verifies nobody's address.
--
-- email_verified_at is nullable and starts null. A user is not blocked from
-- signing in or using the app while unverified - see src/auth/service.ts -
-- this only records whether the address has ever been confirmed reachable.

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ NULL;

CREATE TABLE IF NOT EXISTS email_verification_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL
);

-- Every click on the email link looks up by this.
CREATE UNIQUE INDEX IF NOT EXISTS email_verification_tokens_hash_idx
  ON email_verification_tokens (token_hash);

-- Resending a verification email replaces outstanding tokens for the user.
CREATE INDEX IF NOT EXISTS email_verification_tokens_user_idx
  ON email_verification_tokens (user_id);

-- Housekeeping sweeps expired tokens by this, the same way sessions are swept.
CREATE INDEX IF NOT EXISTS email_verification_tokens_expires_idx
  ON email_verification_tokens (expires_at);

COMMIT;
