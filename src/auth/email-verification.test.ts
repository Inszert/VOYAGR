import { describe, expect, it } from 'vitest';
import {
  hashVerificationToken,
  isVerificationTokenExpired,
  issueVerificationToken,
  verificationTokenExpiry,
  VERIFICATION_TOKEN_DURATION_MS,
} from './email-verification';

describe('issueVerificationToken', () => {
  it('returns a token and a hash that are not the same string', () => {
    const { token, tokenHash } = issueVerificationToken();
    expect(token).not.toBe(tokenHash);
    expect(token.length).toBeGreaterThan(0);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hashes the same token to the same value, deterministically', () => {
    const { token, tokenHash } = issueVerificationToken();
    expect(hashVerificationToken(token)).toBe(tokenHash);
  });

  it('never issues the same token twice', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i += 1) seen.add(issueVerificationToken().token);
    expect(seen.size).toBe(100);
  });
});

describe('verificationTokenExpiry / isVerificationTokenExpired', () => {
  it('expires after exactly its stated duration, not before and not long after', () => {
    const issuedAt = Date.parse('2026-01-01T00:00:00.000Z');
    const expiresAt = verificationTokenExpiry(issuedAt);

    expect(isVerificationTokenExpired(expiresAt, issuedAt)).toBe(false);
    expect(
      isVerificationTokenExpired(expiresAt, issuedAt + VERIFICATION_TOKEN_DURATION_MS - 1),
    ).toBe(false);
    expect(isVerificationTokenExpired(expiresAt, issuedAt + VERIFICATION_TOKEN_DURATION_MS)).toBe(
      true,
    );
  });

  it('is shorter than a session - a one-time action is not a thirty-day credential', () => {
    expect(VERIFICATION_TOKEN_DURATION_MS).toBeLessThan(30 * 24 * 60 * 60 * 1000);
  });
});
