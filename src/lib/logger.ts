import { pino, type Logger } from 'pino';
import { getEnv } from './env';

/**
 * Structured logging.
 *
 * Everything the application logs is JSON with a stable shape, so logs stay
 * queryable once they reach an aggregator. Redaction is configured centrally
 * here rather than trusted to each call site: a credential that leaks into a log
 * is a credential that has leaked.
 */

const REDACTED_PATHS = [
  'password',
  '*.password',
  'apiKey',
  '*.apiKey',
  'api_key',
  '*.api_key',
  'token',
  '*.token',
  'accessToken',
  '*.accessToken',
  'authorization',
  '*.authorization',
  'headers.authorization',
  'headers.cookie',
  'req.headers.authorization',
  'req.headers.cookie',
  'DATABASE_URL',
  'REDIS_URL',
  'ANTHROPIC_API_KEY',
  'VAPID_PRIVATE_KEY',
  'subscription.keys',
  '*.subscription.keys',
];

function createRootLogger(): Logger {
  const env = getEnv();

  return pino({
    level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
    base: {
      service: 'voyagr',
      env: env.NODE_ENV,
    },
    redact: {
      paths: REDACTED_PATHS,
      censor: '[redacted]',
    },
    formatters: {
      level: (label) => ({ level: label }),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

let rootLogger: Logger | undefined;

function getRootLogger(): Logger {
  rootLogger ??= createRootLogger();
  return rootLogger;
}

/**
 * Get a child logger bound to a module name.
 *
 * @example
 *   const log = getLogger('providers.flights.mock');
 *   log.info({ searchId }, 'flight search completed');
 */
export function getLogger(module: string, bindings: Record<string, unknown> = {}): Logger {
  return getRootLogger().child({ module, ...bindings });
}

/** Test helper - drops the memoised root logger so log config can be re-read. */
export function resetLoggerCache(): void {
  rootLogger = undefined;
}
