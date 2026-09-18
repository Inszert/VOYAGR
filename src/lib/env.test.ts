import { describe, expect, it } from 'vitest';
import { describeEnv, EnvValidationError, getCapabilities, parseEnv, SECRET_ENV_KEYS } from './env';

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

describe('getCapabilities', () => {
  it('reports everything off for a bare environment', () => {
    const capabilities = getCapabilities(parseEnv({}));

    expect(capabilities).toEqual({
      database: false,
      redis: false,
      bullmq: false,
      webPush: false,
      liveAi: false,
    });
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

  it('requires both a live provider and a key for live AI', () => {
    expect(getCapabilities(parseEnv({ AI_PROVIDER: 'anthropic' })).liveAi).toBe(false);
    expect(
      getCapabilities(parseEnv({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-test' })).liveAi,
    ).toBe(true);
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
