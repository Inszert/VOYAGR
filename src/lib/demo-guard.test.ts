import { describe, expect, it } from 'vitest';
import { demoLiveAllowed, parseEnv } from './env';

const KEY = 'sand_secret_value_123';
const ok = {
  DEMO_MODE: true,
  LITEAPI_API_KEY: KEY,
  NEXT_PUBLIC_APP_URL: 'https://demo.example.com',
};

describe('demoLiveAllowed', () => {
  it('allows only with demo mode, a sandbox key and a non-production host', () => {
    expect(demoLiveAllowed(ok)).toEqual({ ok: true });
  });

  it('refuses without DEMO_MODE', () => {
    expect(demoLiveAllowed({ ...ok, DEMO_MODE: false }).ok).toBe(false);
  });

  it('refuses a missing or non-sandbox key, without echoing it', () => {
    const live = demoLiveAllowed({ ...ok, LITEAPI_API_KEY: 'prod_abcdef' });
    expect(live.ok).toBe(false);
    expect(JSON.stringify(live)).not.toContain('prod_abcdef');
    expect(demoLiveAllowed({ ...ok, LITEAPI_API_KEY: undefined }).ok).toBe(false);
  });

  it.each([
    'https://www.voyagrfind.com',
    'https://voyagrfind.com/explore',
    'https://staging.voyagrfind.com',
    'https://evilvoyagrfind.com',
  ])('refuses the production host %s', (url) => {
    expect(demoLiveAllowed({ ...ok, NEXT_PUBLIC_APP_URL: url }).ok).toBe(false);
  });
});

describe('parseEnv with DEMO_MODE', () => {
  it('refuses to start when the guard fails, and the reason has no key', () => {
    const source = {
      DEMO_MODE: 'true',
      LITEAPI_API_KEY: KEY,
      NEXT_PUBLIC_APP_URL: 'https://www.voyagrfind.com',
    };
    expect(() => parseEnv(source)).toThrow(/production host/);
    try {
      parseEnv(source);
    } catch (error) {
      expect(String((error as Error).message)).not.toContain(KEY);
    }
  });

  it('starts when the guard passes, and is off by default', () => {
    expect(
      parseEnv({
        DEMO_MODE: 'true',
        LITEAPI_API_KEY: KEY,
        NEXT_PUBLIC_APP_URL: 'https://demo.example.com',
      }).DEMO_MODE,
    ).toBe(true);
    expect(parseEnv({}).DEMO_MODE).toBe(false);
  });
});
