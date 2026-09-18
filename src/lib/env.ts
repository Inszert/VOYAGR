import { z } from 'zod';

/**
 * Validated environment configuration.
 *
 * Rules this module enforces:
 *  - The schema is the single source of truth for what the app may read.
 *  - Nothing outside this module touches `process.env`.
 *  - Absent optional values *disable a capability*; they never crash the app.
 *    That is what lets the foundation boot with no database, no Redis, no
 *    provider credentials and no AI key.
 *  - Secrets are never logged. `describeEnv()` reports presence, never values.
 */

const booleanish = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0', ''])])
  .transform((value) => value === true || value === 'true' || value === '1');

const providerName = z.enum(['mock', 'live']).default('mock');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  NEXT_PUBLIC_APP_URL: z.url().default('http://localhost:3000'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // Persistence — optional. Empty string is normalised to undefined.
  DATABASE_URL: z.string().min(1).optional(),
  DATABASE_SSL: booleanish.default(false),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().max(100).default(10),

  // Queue — optional.
  REDIS_URL: z.string().min(1).optional(),
  QUEUE_DRIVER: z.enum(['memory', 'bullmq']).default('memory'),

  // AI — `mock` needs no credentials.
  AI_PROVIDER: z.enum(['mock', 'anthropic']).default('mock'),
  AI_MODEL: z.string().min(1).default('claude-sonnet-5'),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),

  // Travel provider adapters.
  FLIGHT_PROVIDER: providerName,
  HOTEL_PROVIDER: providerName,
  WEATHER_PROVIDER: providerName,
  TRANSFER_PROVIDER: providerName,
  PLACES_PROVIDER: providerName,
  FLIGHT_PROVIDER_API_KEY: z.string().min(1).optional(),
  HOTEL_PROVIDER_API_KEY: z.string().min(1).optional(),
  WEATHER_PROVIDER_API_KEY: z.string().min(1).optional(),
  TRANSFER_PROVIDER_API_KEY: z.string().min(1).optional(),
  PLACES_PROVIDER_API_KEY: z.string().min(1).optional(),

  // Web Push.
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: z.string().min(1).optional(),
  VAPID_PRIVATE_KEY: z.string().min(1).optional(),
  VAPID_SUBJECT: z.string().min(1).default('mailto:dev@example.invalid'),
});

export type Env = z.infer<typeof envSchema>;

/** Keys whose values must never reach a log, an error message or the client. */
export const SECRET_ENV_KEYS = [
  'DATABASE_URL',
  'REDIS_URL',
  'ANTHROPIC_API_KEY',
  'FLIGHT_PROVIDER_API_KEY',
  'HOTEL_PROVIDER_API_KEY',
  'WEATHER_PROVIDER_API_KEY',
  'TRANSFER_PROVIDER_API_KEY',
  'PLACES_PROVIDER_API_KEY',
  'VAPID_PRIVATE_KEY',
] as const satisfies readonly (keyof Env)[];

export class EnvValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid environment configuration:\n  - ${issues.join('\n  - ')}`);
    this.name = 'EnvValidationError';
    this.issues = issues;
  }
}

/** Treat `FOO=` in a dotenv file as "not set" rather than as an empty string. */
function stripEmptyStrings(source: Record<string, string | undefined>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && value !== '') out[key] = value;
  }
  return out;
}

export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(stripEmptyStrings(source));

  if (!result.success) {
    // Report which variable failed and why — never the offending value, which
    // may itself be a secret.
    const issues = result.error.issues.map(
      (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    throw new EnvValidationError(issues);
  }

  return result.data;
}

let cached: Env | undefined;

/**
 * Lazily parse and memoise the process environment.
 *
 * Lazy on purpose: importing this module must never throw at build time, so
 * `next build` and unit tests work without a populated environment.
 */
export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}

/** Test helper — drops the memoised value so a test can vary the environment. */
export function resetEnvCache(): void {
  cached = undefined;
}

export interface EnvCapabilities {
  database: boolean;
  redis: boolean;
  bullmq: boolean;
  webPush: boolean;
  liveAi: boolean;
}

/** Which capabilities the current configuration actually enables. */
export function getCapabilities(env: Env = getEnv()): EnvCapabilities {
  return {
    database: Boolean(env.DATABASE_URL),
    redis: Boolean(env.REDIS_URL),
    bullmq: env.QUEUE_DRIVER === 'bullmq' && Boolean(env.REDIS_URL),
    webPush: Boolean(env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY),
    liveAi: env.AI_PROVIDER !== 'mock' && Boolean(env.ANTHROPIC_API_KEY),
  };
}

/**
 * A log-safe description of the environment: secrets are reduced to a boolean
 * "is it set". Safe to print at boot and to return from a diagnostics endpoint.
 */
export function describeEnv(env: Env = getEnv()): Record<string, string | boolean | number> {
  const secrets = new Set<string>(SECRET_ENV_KEYS);
  const described: Record<string, string | boolean | number> = {};

  // Every secret key is reported, set or not. An optional variable that Zod
  // dropped would otherwise vanish from the report entirely, which reads as
  // "no such setting" rather than "not configured".
  for (const key of SECRET_ENV_KEYS) {
    described[key] = false;
  }

  for (const [key, value] of Object.entries(env)) {
    described[key] = secrets.has(key) ? Boolean(value) : (value as string | boolean | number);
  }

  return described;
}
