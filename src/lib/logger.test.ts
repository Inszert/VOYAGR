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

  it('still redacts the credentials it always did', () => {
    expect(capture({ password: 'hunter2' })).not.toContain('hunter2');
  });
});
