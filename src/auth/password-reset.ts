import { createHash, randomBytes } from 'node:crypto';

/**
 * Password reset tokens.
 *
 * Same reasoning as `session.ts` and `email-verification.ts`: the link in
 * the email carries a random token, the database stores only its SHA-256.
 *
 * Shorter-lived than email verification deliberately: a working link to
 * change someone's password is a more sensitive thing to leave valid than a
 * working link to confirm an address, so one hour rather than twenty-four.
 */

/** 256 bits of entropy. */
const TOKEN_BYTES = 32;

/** One hour - short, because this link can change a password, not just confirm an address. */
export const PASSWORD_RESET_TOKEN_DURATION_MS = 60 * 60 * 1000;

export interface IssuedPasswordResetToken {
  /** Goes in the email link. Never stored, never logged. */
  readonly token: string;
  /** Goes in the database. */
  readonly tokenHash: string;
}

export function issuePasswordResetToken(): IssuedPasswordResetToken {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  return { token, tokenHash: hashPasswordResetToken(token) };
}

export function hashPasswordResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Expiry for a token issued now. */
export function passwordResetTokenExpiry(now: number): string {
  return new Date(now + PASSWORD_RESET_TOKEN_DURATION_MS).toISOString();
}

export function isPasswordResetTokenExpired(expiresAt: string, now: number): boolean {
  return Date.parse(expiresAt) <= now;
}
