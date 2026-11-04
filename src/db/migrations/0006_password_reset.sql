-- Password reset.
--
-- Same shape as email_verification_tokens (0005) and sessions (0002), for
-- the same reason: the database stores only the SHA-256 of the token that
-- goes in the email link, never the token itself.

BEGIN;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL
);

-- Every click on the reset link looks up by this.
CREATE UNIQUE INDEX IF NOT EXISTS password_reset_tokens_hash_idx
  ON password_reset_tokens (token_hash);

-- Requesting a new reset link replaces outstanding tokens for the user.
CREATE INDEX IF NOT EXISTS password_reset_tokens_user_idx
  ON password_reset_tokens (user_id);

-- Housekeeping sweeps expired tokens by this, the same way sessions are swept.
CREATE INDEX IF NOT EXISTS password_reset_tokens_expires_idx
  ON password_reset_tokens (expires_at);

COMMIT;
