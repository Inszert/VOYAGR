import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto';
import { promisify } from 'node:util';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from './password-policy';

/**
 * Password hashing.
 *
 * scrypt from Node's own crypto, rather than a dependency. It is memory-hard,
 * it is in the standard library, and the alternative - adding argon2 or bcrypt -
 * means a native module in the build for a property scrypt already has.
 *
 * Two rules this module exists to enforce:
 *  - A stored hash is self-describing. The algorithm and its parameters travel
 *    with the hash, so raising the cost later does not invalidate every
 *    existing password: an old hash still says how to verify itself.
 *  - Comparison is constant-time. A byte-by-byte early return leaks the hash
 *    one character at a time to anyone willing to measure.
 */

/*
 * `promisify` picks the three-argument overload, which drops the options we
 * need to set the cost. The cast restores the four-argument form rather than
 * hand-rolling a Promise wrapper around the callback.
 */
const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

/**
 * Cost parameters.
 *
 * N=2^15 with r=8 needs 32 MiB per hash, which is the point: it is the memory
 * that makes parallel cracking expensive. `maxmem` is raised above that,
 * because Node's 32 MiB default sits exactly on the boundary and would reject
 * these parameters.
 */
const SCRYPT_N = 32_768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_MAXMEM = 96 * 1024 * 1024;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

// Re-exported so server-side callers have one import for hashing and policy,
// while a client component can take the constants alone.
export { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from './password-policy';

export class PasswordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PasswordError';
  }
}

async function derive(password: string, salt: Buffer): Promise<Buffer> {
  return (await scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  })) as Buffer;
}

/**
 * Hash a password for storage.
 *
 * The result is `scrypt$N$r$p$salt$hash`, base64url throughout, and is the only
 * form a password may take at rest.
 */
export async function hashPassword(password: string): Promise<string> {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new PasswordError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new PasswordError(`Password must be at most ${MAX_PASSWORD_LENGTH} characters`);
  }

  const salt = randomBytes(SALT_LENGTH);
  const hash = await derive(password, salt);

  return [
    'scrypt',
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString('base64url'),
    hash.toString('base64url'),
  ].join('$');
}

/**
 * Verify a password against a stored hash.
 *
 * Returns false rather than throwing for any malformed or unrecognised stored
 * value. A corrupt row must read as "wrong password", not as a 500 that tells
 * an attacker they found something interesting.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (password.length === 0 || password.length > MAX_PASSWORD_LENGTH) return false;

  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, rawN, rawR, rawP, rawSalt, rawHash] = parts as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];

  const N = Number(rawN);
  const r = Number(rawR);
  const p = Number(rawP);
  if (!Number.isSafeInteger(N) || !Number.isSafeInteger(r) || !Number.isSafeInteger(p))
    return false;

  const salt = Buffer.from(rawSalt, 'base64url');
  const expected = Buffer.from(rawHash, 'base64url');
  if (salt.length === 0 || expected.length === 0) return false;

  let actual: Buffer;
  try {
    actual = (await scrypt(password.normalize('NFKC'), salt, expected.length, {
      N,
      r,
      p,
      maxmem: SCRYPT_MAXMEM,
    })) as Buffer;
  } catch {
    // Parameters the current Node cannot satisfy, e.g. a cost raised beyond
    // maxmem. Unverifiable is not the same as valid.
    return false;
  }

  // Lengths are equal by construction above, but timingSafeEqual throws if they
  // are not, and a throw here would be an oracle of its own.
  if (actual.length !== expected.length) return false;

  return timingSafeEqual(actual, expected);
}

/**
 * A hash to compare against when no user was found.
 *
 * Sign-in must take about as long whether or not the email exists, or the
 * response time answers "is this address registered?" for anyone who asks.
 * Generated once per process against a random password nobody holds.
 */
let decoyHash: Promise<string> | undefined;

export function getDecoyHash(): Promise<string> {
  decoyHash ??= hashPassword(randomBytes(24).toString('base64url'));
  return decoyHash;
}
