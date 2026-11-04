import { createHash, randomBytes } from 'node:crypto';

/**
 * Email change tokens.
 *
 * Same reasoning as `session.ts`, `email-verification.ts` and
 * `password-reset.ts`: the link carries a random token, the database stores
 * only its SHA-256.
 *
 * One hour, the same as a password reset and for the same reason: this
 * link, once clicked, changes what address controls the account.
 */

/** 256 bits of entropy. */
const TOKEN_BYTES = 32;

export const EMAIL_CHANGE_TOKEN_DURATION_MS = 60 * 60 * 1000;

export interface IssuedEmailChangeToken {
  /** Goes in the email link. Never stored, never logged. */
  readonly token: string;
  /** Goes in the database. */
  readonly tokenHash: string;
}

export function issueEmailChangeToken(): IssuedEmailChangeToken {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  return { token, tokenHash: hashEmailChangeToken(token) };
}

export function hashEmailChangeToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Expiry for a token issued now. */
export function emailChangeTokenExpiry(now: number): string {
  return new Date(now + EMAIL_CHANGE_TOKEN_DURATION_MS).toISOString();
}

export function isEmailChangeTokenExpired(expiresAt: string, now: number): boolean {
  return Date.parse(expiresAt) <= now;
}
