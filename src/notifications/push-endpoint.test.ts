import { describe, expect, it } from 'vitest';
import { isPublicPushEndpoint } from './push-endpoint';

describe('isPublicPushEndpoint', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/abc',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://wns2-par02p.notify.windows.com/w/?token=abc',
    'https://web.push.apple.com/abc',
  ])('accepts the real push service %s', (value) => {
    expect(isPublicPushEndpoint(value)).toBe(true);
  });

  it.each([
    'http://fcm.googleapis.com/x',
    'https://169.254.169.254/latest/meta-data/',
    'https://0x7f000001/',
    'https://2130706433/',
    'https://127.0.0.1/',
    'https://[::1]/',
    'https://localhost/',
    'https://localhost./',
    'https://db/',
    'https://metadata.internal/',
    'https://printer.local/',
    'https://fcm.googleapis.com:8443/x',
    'https://user:pw@fcm.googleapis.com/x',
    'ftp://fcm.googleapis.com/x',
    'not a url',
    '',
  ])('refuses %s', (value) => {
    expect(isPublicPushEndpoint(value)).toBe(false);
  });
});
