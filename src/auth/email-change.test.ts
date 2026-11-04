import { describe, expect, it } from 'vitest';
import {
  emailChangeTokenExpiry,
  hashEmailChangeToken,
  isEmailChangeTokenExpired,
  issueEmailChangeToken,
  EMAIL_CHANGE_TOKEN_DURATION_MS,
} from './email-change';

describe('issueEmailChangeToken', () => {
  it('returns a token and a hash that are not the same string', () => {
    const { token, tokenHash } = issueEmailChangeToken();
    expect(token).not.toBe(tokenHash);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hashes the same token to the same value, deterministically', () => {
    const { token, tokenHash } = issueEmailChangeToken();
    expect(hashEmailChangeToken(token)).toBe(tokenHash);
  });

  it('never issues the same token twice', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i += 1) seen.add(issueEmailChangeToken().token);
    expect(seen.size).toBe(100);
  });
});

describe('emailChangeTokenExpiry / isEmailChangeTokenExpired', () => {
  it('expires after exactly its stated duration, not before and not long after', () => {
    const issuedAt = Date.parse('2026-01-01T00:00:00.000Z');
    const expiresAt = emailChangeTokenExpiry(issuedAt);

    expect(isEmailChangeTokenExpired(expiresAt, issuedAt)).toBe(false);
    expect(
      isEmailChangeTokenExpired(expiresAt, issuedAt + EMAIL_CHANGE_TOKEN_DURATION_MS - 1),
    ).toBe(false);
    expect(isEmailChangeTokenExpired(expiresAt, issuedAt + EMAIL_CHANGE_TOKEN_DURATION_MS)).toBe(
      true,
    );
  });
});
