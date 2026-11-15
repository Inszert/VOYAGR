import { Writable } from 'node:stream';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { REDACTED_PATHS } from './logger';

function capture(entry: Record<string, unknown>): string {
  let out = '';
  const stream = new Writable({
    write(chunk, _encoding, done) {
      out += String(chunk);
      done();
    },
  });
  pino({ redact: { paths: REDACTED_PATHS, censor: '[redacted]' } }, stream).info(entry, 'x');
  return out;
}

describe('log redaction', () => {
  it('never writes a phone number, at the top level or one level down', () => {
    expect(capture({ phone: '+44 7700 900123' })).not.toContain('900123');
    expect(capture({ contact: { phone: '+44 7700 900123' } })).not.toContain('900123');
    expect(capture({ emergencyContacts: [{ phone: '+44 7700 900123' }] })).not.toContain('900123');
  });

  it('never writes an email address, a one-time link or a cookie', () => {
    expect(capture({ email: 'ada@example.com' })).not.toContain('ada@example.com');
    expect(capture({ user: { email: 'ada@example.com' } })).not.toContain('ada@example.com');
    expect(capture({ newEmail: 'ada@example.com' })).not.toContain('ada@example.com');
    expect(capture({ link: 'https://x.test/reset-password?token=abc123' })).not.toContain('abc123');
    expect(capture({ mail: { link: 'https://x.test/?token=abc123' } })).not.toContain('abc123');
    expect(capture({ tokenHash: 'deadbeef' })).not.toContain('deadbeef');
    expect(capture({ cookie: 'voyagr_session=s3cret' })).not.toContain('s3cret');
  });

  it('still redacts the credentials it always did', () => {
    expect(capture({ password: 'hunter2' })).not.toContain('hunter2');
  });
});
