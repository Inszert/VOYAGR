import { describe, expect, it } from 'vitest';
import { AppError } from './errors';
import { describeEnv, EnvValidationError, getCapabilities, parseEnv, SECRET_ENV_KEYS } from './env';

/** A production environment that has everything it needs to start. */
const PRODUCTION = { NODE_ENV: 'production', NEXT_PUBLIC_APP_URL: 'https://example.com' };

/** Runs `fn` and returns what it threw, failing the test if it returned normally. */
function thrownBy(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected the function to throw');
}

describe('parseEnv', () => {
  it('applies defaults so the app boots with an empty environment', () => {
    // This is the property that makes the foundation runnable with no setup.
    const env = parseEnv({});

    expect(env.NODE_ENV).toBe('development');
    expect(env.QUEUE_DRIVER).toBe('memory');
    expect(env.AI_PROVIDER).toBe('mock');
    expect(env.FLIGHT_PROVIDER).toBe('mock');
  });

  it('treats an empty string as unset', () => {
    // `DATABASE_URL=` in a dotenv file means "not configured", not "empty host".
    const env = parseEnv({ DATABASE_URL: '', ANTHROPIC_API_KEY: '' });

    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('coerces booleans and numbers from strings', () => {
    const env = parseEnv({ DATABASE_SSL: 'true', DATABASE_POOL_MAX: '25' });

    expect(env.DATABASE_SSL).toBe(true);
    expect(env.DATABASE_POOL_MAX).toBe(25);
  });

  it('rejects an invalid enum value', () => {
    expect(() => parseEnv({ QUEUE_DRIVER: 'rabbitmq' })).toThrow(EnvValidationError);
    expect(() => parseEnv({ LOG_LEVEL: 'verbose' })).toThrow(EnvValidationError);
  });

  it('rejects AI_PROVIDER=anthropic with a message that says why, until an adapter exists', () => {
    expect(() => parseEnv({ AI_PROVIDER: 'anthropic' })).toThrow(EnvValidationError);
    expect(() => parseEnv({ AI_PROVIDER: 'anthropic' })).toThrow(/AI_PROVIDER.*not implemented/);
    expect(parseEnv({ AI_PROVIDER: 'mock' }).AI_PROVIDER).toBe('mock');
  });

  it('reads the places refresh interval in hours, a week by default and never below one', () => {
    expect(parseEnv({}).PLACES_REFRESH_HOURS).toBe(168);
    expect(parseEnv({ PLACES_REFRESH_HOURS: '24' }).PLACES_REFRESH_HOURS).toBe(24);
    expect(() => parseEnv({ PLACES_REFRESH_HOURS: '0' })).toThrow(EnvValidationError);
  });

  it('no longer declares variables that no code read', () => {
    const declared = Object.keys(parseEnv({}));

    expect(declared).not.toContain('HOTEL_REFRESH_MINUTES');
    expect(declared.filter((key) => key.endsWith('_PROVIDER_API_KEY'))).toEqual([]);
  });

  it('rejects a malformed app URL', () => {
    expect(() => parseEnv({ NEXT_PUBLIC_APP_URL: 'not-a-url' })).toThrow(EnvValidationError);
  });

  it('names the offending variable without echoing its value', () => {
    // An error message that quotes the bad value can leak a secret into a log.
    try {
      parseEnv({ AI_PROVIDER: 'super-secret-vendor-name' });
      expect.unreachable('should have thrown');
    } catch (error) {
      const message = (error as EnvValidationError).message;
      expect(message).toContain('AI_PROVIDER');
      expect(message).not.toContain('super-secret-vendor-name');
    }
  });
});

describe('provider defaults by environment', () => {
  it('defaults weather to the real keyless provider outside a test run', () => {
    expect(parseEnv({}).WEATHER_PROVIDER).toBe('open-meteo');
    expect(parseEnv({ NODE_ENV: 'development' }).WEATHER_PROVIDER).toBe('open-meteo');
    expect(parseEnv(PRODUCTION).WEATHER_PROVIDER).toBe('open-meteo');
  });

  it('defaults weather to the mock under test, and honours an explicit choice anywhere', () => {
    expect(parseEnv({ NODE_ENV: 'test' }).WEATHER_PROVIDER).toBe('mock');
    expect(parseEnv({ NODE_ENV: 'development', WEATHER_PROVIDER: 'mock' }).WEATHER_PROVIDER).toBe(
      'mock',
    );
    expect(parseEnv({ NODE_ENV: 'test', WEATHER_PROVIDER: 'open-meteo' }).WEATHER_PROVIDER).toBe(
      'open-meteo',
    );
  });

  it('defaults the slots with no live adapter to absent in production, and to mock elsewhere', () => {
    const production = parseEnv(PRODUCTION);
    expect([
      production.HOTEL_PROVIDER,
      production.TRANSFER_PROVIDER,
      production.STAY_PROVIDERS,
    ]).toEqual(['absent', 'absent', 'absent']);
    // Places have a real, keyless source, so production reads it rather than saying nothing.
    expect(production.PLACES_PROVIDER).toBe('wikidata');
    expect(parseEnv({ ...PRODUCTION, PLACES_PROVIDER: 'absent' }).PLACES_PROVIDER).toBe('absent');

    const development = parseEnv({ NODE_ENV: 'development' });
    expect([
      development.HOTEL_PROVIDER,
      development.TRANSFER_PROVIDER,
      development.PLACES_PROVIDER,
    ]).toEqual(['mock', 'mock', 'mock']);
  });

  it('does not allow fixtures in production unless asked for by name', () => {
    expect(parseEnv(PRODUCTION).ALLOW_MOCK_IN_PRODUCTION).toBe(false);
    expect(
      parseEnv({ ...PRODUCTION, ALLOW_MOCK_IN_PRODUCTION: 'true' }).ALLOW_MOCK_IN_PRODUCTION,
    ).toBe(true);
  });
});

describe('getCapabilities', () => {
  it('reports every credentialled capability off for a bare environment', () => {
    const capabilities = getCapabilities(parseEnv({}));

    expect(capabilities).toEqual({
      database: false,
      redis: false,
      bullmq: false,
      webPush: false,
      liveAi: false,
      // Imagery needs no key, so it is the one capability a bare environment
      // still has. Turning it off is a deliberate setting, not a missing one.
      imagery: true,
    });
  });

  it('lets imagery be switched off without anything else changing', () => {
    expect(getCapabilities(parseEnv({ IMAGERY_PROVIDER: 'none' })).imagery).toBe(false);
  });

  it('requires both a Redis URL and the bullmq driver', () => {
    expect(getCapabilities(parseEnv({ QUEUE_DRIVER: 'bullmq' })).bullmq).toBe(false);
    expect(
      getCapabilities(parseEnv({ QUEUE_DRIVER: 'bullmq', REDIS_URL: 'redis://localhost:6379' }))
        .bullmq,
    ).toBe(true);
  });

  it('requires both VAPID keys for web push', () => {
    expect(getCapabilities(parseEnv({ NEXT_PUBLIC_VAPID_PUBLIC_KEY: 'pub' })).webPush).toBe(false);
    expect(
      getCapabilities(parseEnv({ NEXT_PUBLIC_VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv' }))
        .webPush,
    ).toBe(true);
  });

  it('has no live AI while the only adapter is the mock, whatever key is set', () => {
    expect(getCapabilities(parseEnv({ ANTHROPIC_API_KEY: 'sk-test' })).liveAi).toBe(false);
  });
});

describe('describeEnv', () => {
  it('reduces every secret to a boolean', () => {
    const env = parseEnv({
      DATABASE_URL: 'postgresql://user:hunter2@localhost:5432/voyagr',
      ANTHROPIC_API_KEY: 'sk-ant-secret-value',
      VAPID_PRIVATE_KEY: 'private-key-material',
    });

    const described = describeEnv(env);
    const serialised = JSON.stringify(described);

    expect(described.DATABASE_URL).toBe(true);
    expect(described.ANTHROPIC_API_KEY).toBe(true);
    expect(serialised).not.toContain('hunter2');
    expect(serialised).not.toContain('sk-ant-secret-value');
    expect(serialised).not.toContain('private-key-material');
  });

  it('passes non-secret values through unchanged', () => {
    const described = describeEnv(parseEnv({ LOG_LEVEL: 'debug' }));
    expect(described.LOG_LEVEL).toBe('debug');
  });

  it('covers every declared secret key', () => {
    const described = describeEnv(parseEnv({}));

    for (const key of SECRET_ENV_KEYS) {
      expect(typeof described[key]).toBe('boolean');
    }
  });
});

describe('production app URL', () => {
  function configurationErrorFor(source: Record<string, string | undefined>): AppError {
    const error = thrownBy(() => parseEnv(source));
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('CONFIGURATION_ERROR');
    return error as AppError;
  }

  it('refuses to start in production when NEXT_PUBLIC_APP_URL is not set', () => {
    const error = configurationErrorFor({ NODE_ENV: 'production' });

    expect(error.message).toContain('NEXT_PUBLIC_APP_URL');
    expect(error.message).toContain('is not set');
  });

  it('treats an empty NEXT_PUBLIC_APP_URL as not set', () => {
    expect(configurationErrorFor({ ...PRODUCTION, NEXT_PUBLIC_APP_URL: '' }).message).toContain(
      'is not set',
    );
  });

  it.each([
    'http://localhost:3000',
    'https://localhost',
    'http://127.0.0.1:3000',
    'http://127.0.1.5',
    'http://[::1]:3000',
    'http://app.localhost:3000',
  ])('refuses %s in production', (url) => {
    const error = configurationErrorFor({ ...PRODUCTION, NEXT_PUBLIC_APP_URL: url });

    expect(error.message).toContain('NEXT_PUBLIC_APP_URL');
    expect(error.message).toContain('localhost');
    // The value is not echoed back, only the variable and the problem.
    expect(error.message).not.toContain(url);
  });

  it('accepts a public origin in production', () => {
    expect(
      parseEnv({ ...PRODUCTION, NEXT_PUBLIC_APP_URL: 'https://example.com' }).NEXT_PUBLIC_APP_URL,
    ).toBe('https://example.com');
  });

  it('does not mistake a public host that merely mentions localhost for a local one', () => {
    expect(
      parseEnv({ ...PRODUCTION, NEXT_PUBLIC_APP_URL: 'https://localhost.example.com' })
        .NEXT_PUBLIC_APP_URL,
    ).toBe('https://localhost.example.com');
    expect(
      parseEnv({ ...PRODUCTION, NEXT_PUBLIC_APP_URL: 'https://example.com/localhost' })
        .NEXT_PUBLIC_APP_URL,
    ).toBe('https://example.com/localhost');
  });

  it('still reports a malformed URL in production as a validation error', () => {
    expect(
      thrownBy(() => parseEnv({ ...PRODUCTION, NEXT_PUBLIC_APP_URL: 'not-a-url' })),
    ).toBeInstanceOf(EnvValidationError);
  });

  it('keeps the localhost default in development and test, and allows localhost there', () => {
    expect(parseEnv({}).NEXT_PUBLIC_APP_URL).toBe('http://localhost:3000');
    expect(parseEnv({ NODE_ENV: 'development' }).NEXT_PUBLIC_APP_URL).toBe('http://localhost:3000');
    expect(parseEnv({ NODE_ENV: 'test' }).NEXT_PUBLIC_APP_URL).toBe('http://localhost:3000');
    expect(
      parseEnv({ NODE_ENV: 'test', NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3100' })
        .NEXT_PUBLIC_APP_URL,
    ).toBe('http://127.0.0.1:3100');
  });
});
