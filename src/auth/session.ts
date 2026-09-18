import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Session tokens.
 *
 * The cookie carries a random token; the database stores only its SHA-256. A
 * dump of the sessions table therefore grants nobody a session, which is the
 * entire reason the raw token is never persisted.
 *
 * SHA-256 with no salt or stretching is correct here and wrong for a password:
 * a 256-bit random token has no guessable structure, so there is nothing for a
 * dictionary to attack and no reason to pay scrypt's cost on every request.
 */

/** 256 bits of entropy. Long enough that guessing is not a threat model. */
const TOKEN_BYTES = 32;

/** How long a session lasts without being renewed. */
export const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

export const SESSION_COOKIE_NAME = 'voyagr_session';

export interface IssuedToken {
  /** Goes in the cookie. Never stored, never logged. */
  readonly token: string;
  /** Goes in the database. */
  readonly tokenHash: string;
}

export function issueSessionToken(): IssuedToken {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  return { token, tokenHash: hashSessionToken(token) };
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Compare two token hashes without leaking where they diverge.
 *
 * Lookup is by hash so this is belt and braces, but a hash comparison that
 * short-circuits is the kind of thing that becomes exploitable once someone
 * later changes how the lookup works.
 */
export function sessionHashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/** Expiry for a session created now. */
export function sessionExpiry(now: number): string {
  return new Date(now + SESSION_DURATION_MS).toISOString();
}

export function isExpired(expiresAt: string, now: number): boolean {
  return Date.parse(expiresAt) <= now;
}

/*
 * Sliding renewal is deliberately absent rather than half-built.
 *
 * A cookie cannot be set while a server component renders, so extending a
 * session on read would have to happen in middleware or a route handler. Until
 * that exists, a session lasts its full duration and no longer, and an active
 * user signs in again after thirty days. A `needsRenewal` helper that nothing
 * called was worse: it read as though renewal worked.
 */

/**
 * Cookie attributes.
 *
 * `httpOnly` keeps the token away from script, which is what makes an XSS a bad
 * day rather than a full account takeover. `sameSite: lax` is the CSRF floor
 * under Next's own Server Action origin checks. `secure` is conditional only so
 * that plain-HTTP localhost development works; production is always secure.
 */
export function sessionCookieOptions(secure: boolean) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure,
    path: '/',
    maxAge: Math.floor(SESSION_DURATION_MS / 1000),
  };
}
