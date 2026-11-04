-- Changing an account's email address.
--
-- A request does not change users.email directly - it is only applied once
-- the *new* address is confirmed reachable, by clicking a link sent there.
-- Same token shape as email_verification_tokens and password_reset_tokens,
-- plus the one field this needs that those do not: the address being moved
-- to, so confirming the link does not have to guess what was requested.

BEGIN;

CREATE TABLE IF NOT EXISTS email_change_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  new_email   TEXT NOT NULL,
  token_hash  TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS email_change_tokens_hash_idx
  ON email_change_tokens (token_hash);

-- Requesting a new change replaces outstanding tokens for the user.
CREATE INDEX IF NOT EXISTS email_change_tokens_user_idx
  ON email_change_tokens (user_id);

-- Housekeeping sweeps expired tokens by this, the same way sessions are swept.
CREATE INDEX IF NOT EXISTS email_change_tokens_expires_idx
  ON email_change_tokens (expires_at);

COMMIT;
