import { describe, expect, it } from 'vitest';
import { safeNextPath } from './return-to';

describe('safeNextPath', () => {
  it.each(['/invite/abc', '/trips/1', '/account?x=1', '/'])('accepts %s', (v) => {
    expect(safeNextPath(v)).toBe(v);
  });

  it.each([
    '//evil.com',
    '/\\evil',
    '/\\/evil.com',
    'https://evil.com',
    'javascript:alert(1)',
    '/javascript:alert(1)',
    'invite/abc',
    '',
    '/a\r\nSet-Cookie: x=1',
    '/a\nb',
    '/' + 'a'.repeat(600),
  ])('rejects %j', (v) => {
    expect(safeNextPath(v)).toBeNull();
  });

  it('rejects non-strings', () => {
    expect(safeNextPath(undefined)).toBeNull();
    expect(safeNextPath(null)).toBeNull();
    expect(safeNextPath(['/a'])).toBeNull();
  });
});
