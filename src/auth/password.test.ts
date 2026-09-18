import { describe, expect, it } from 'vitest';
import {
  getDecoyHash,
  hashPassword,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  PasswordError,
  verifyPassword,
} from './password';

const PASSWORD = 'correct-horse-battery-staple';

describe('hashPassword', () => {
  it('produces a self-describing hash', async () => {
    // The algorithm and its parameters travel with the hash, so raising the
    // cost later does not invalidate every password already stored.
    const hash = await hashPassword(PASSWORD);
    const [algorithm, n, r, p] = hash.split('$');

    expect(algorithm).toBe('scrypt');
    expect(Number(n)).toBeGreaterThan(1024);
    expect(Number(r)).toBeGreaterThan(0);
    expect(Number(p)).toBeGreaterThan(0);
  });

  it('salts, so the same password never hashes twice the same', async () => {
    expect(await hashPassword(PASSWORD)).not.toBe(await hashPassword(PASSWORD));
  });

  it('never contains the password', async () => {
    const hash = await hashPassword(PASSWORD);
    expect(hash).not.toContain(PASSWORD);
  });

  it('refuses a password below the minimum length', async () => {
    await expect(hashPassword('a'.repeat(MIN_PASSWORD_LENGTH - 1))).rejects.toThrow(PasswordError);
  });

  it('refuses an absurdly long password', async () => {
    // Unbounded input into a deliberately expensive function is a denial of
    // service with extra steps.
    await expect(hashPassword('a'.repeat(MAX_PASSWORD_LENGTH + 1))).rejects.toThrow(PasswordError);
  });
});

describe('verifyPassword', () => {
  it('accepts the right password and rejects the wrong one', async () => {
    const hash = await hashPassword(PASSWORD);

    expect(await verifyPassword(PASSWORD, hash)).toBe(true);
    expect(await verifyPassword('not the password', hash)).toBe(false);
    expect(await verifyPassword(PASSWORD.toUpperCase(), hash)).toBe(false);
  });

  it('treats equivalent unicode spellings as the same password', async () => {
    // Composed and decomposed forms look identical in a password field, so a
    // user who types one and stored the other must still get in.
    const composed = 'pässwort-für-die-reise';
    const decomposed = composed.normalize('NFD');

    expect(composed).not.toBe(decomposed);
    expect(await verifyPassword(decomposed, await hashPassword(composed))).toBe(true);
  });

  it('reads a corrupt or unknown stored value as "wrong password"', async () => {
    // A 500 here would tell an attacker they had found something interesting.
    for (const stored of [
      '',
      'not-a-hash',
      'scrypt$only$three$parts',
      'bcrypt$32768$8$1$c2FsdA$aGFzaA',
      'scrypt$notanumber$8$1$c2FsdA$aGFzaA',
      'scrypt$32768$8$1$$',
    ]) {
      expect(await verifyPassword(PASSWORD, stored)).toBe(false);
    }
  });

  it('rejects an empty password without consulting the hash', async () => {
    expect(await verifyPassword('', await hashPassword(PASSWORD))).toBe(false);
  });
});

describe('getDecoyHash', () => {
  it('returns a verifiable hash no real password matches', async () => {
    const decoy = await getDecoyHash();

    expect(decoy.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword(PASSWORD, decoy)).toBe(false);
  });

  it('is stable within a process, so it costs one derivation not one per attempt', async () => {
    expect(await getDecoyHash()).toBe(await getDecoyHash());
  });
});
