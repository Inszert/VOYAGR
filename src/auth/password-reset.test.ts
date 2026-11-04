import { describe, expect, it } from 'vitest';
import {
  hashPasswordResetToken,
  isPasswordResetTokenExpired,
  issuePasswordResetToken,
  passwordResetTokenExpiry,
  PASSWORD_RESET_TOKEN_DURATION_MS,
} from './password-reset';
import { VERIFICATION_TOKEN_DURATION_MS } from './email-verification';

describe('issuePasswordResetToken', () => {
  it('returns a token and a hash that are not the same string', () => {
    const { token, tokenHash } = issuePasswordResetToken();
    expect(token).not.toBe(tokenHash);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hashes the same token to the same value, deterministically', () => {
    const { token, tokenHash } = issuePasswordResetToken();
    expect(hashPasswordResetToken(token)).toBe(tokenHash);
  });

  it('never issues the same token twice', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i += 1) seen.add(issuePasswordResetToken().token);
    expect(seen.size).toBe(100);
  });
});

describe('passwordResetTokenExpiry / isPasswordResetTokenExpired', () => {
  it('expires after exactly its stated duration, not before and not long after', () => {
    const issuedAt = Date.parse('2026-01-01T00:00:00.000Z');
    const expiresAt = passwordResetTokenExpiry(issuedAt);

    expect(isPasswordResetTokenExpired(expiresAt, issuedAt)).toBe(false);
    expect(
      isPasswordResetTokenExpired(expiresAt, issuedAt + PASSWORD_RESET_TOKEN_DURATION_MS - 1),
    ).toBe(false);
    expect(
      isPasswordResetTokenExpired(expiresAt, issuedAt + PASSWORD_RESET_TOKEN_DURATION_MS),
    ).toBe(true);
  });

  it('is shorter-lived than an email verification link - a password change is more sensitive than confirming an address', () => {
    expect(PASSWORD_RESET_TOKEN_DURATION_MS).toBeLessThan(VERIFICATION_TOKEN_DURATION_MS);
  });
});
