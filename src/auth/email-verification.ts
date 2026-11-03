import { createHash, randomBytes } from 'node:crypto';

/**
 * Email verification tokens.
 *
 * Same reasoning as `session.ts`: the link in the email carries a random
 * token, the database stores only its SHA-256, and a dump of the table
 * verifies nobody's address. SHA-256 with no salt or stretching is correct
 * for the same reason it is correct for a session token - 256 bits of
 * entropy has no guessable structure, so there is nothing for a dictionary
 * to attack.
 */

/** 256 bits of entropy. */
const TOKEN_BYTES = 32;

/**
 * How long a verification link stays valid.
 *
 * Short, deliberately: this is a one-time action a user takes right after
 * signing up or clicking "resend", not a credential meant to last. Thirty
 * days (a session's lifetime) would leave a stale, forwardable link valid
 * for a month.
 */
export const VERIFICATION_TOKEN_DURATION_MS = 24 * 60 * 60 * 1000;

export interface IssuedVerificationToken {
  /** Goes in the email link. Never stored, never logged. */
  readonly token: string;
  /** Goes in the database. */
  readonly tokenHash: string;
}

export function issueVerificationToken(): IssuedVerificationToken {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  return { token, tokenHash: hashVerificationToken(token) };
}

export function hashVerificationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Expiry for a token issued now. */
export function verificationTokenExpiry(now: number): string {
  return new Date(now + VERIFICATION_TOKEN_DURATION_MS).toISOString();
}

export function isVerificationTokenExpired(expiresAt: string, now: number): boolean {
  return Date.parse(expiresAt) <= now;
}
