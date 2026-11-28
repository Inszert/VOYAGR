/**
 * Every tuning number for the Kiwi MCP path, in one place.
 *
 * Nothing here is a secret. The server needs no key and the host is fixed: no
 * caller can point the client anywhere else.
 */

/** The only host flight data may come from. */
export const KIWI_MCP_URL = 'https://mcp.kiwi.com';

/** One call, from request to answer. Change here, nowhere else. */
export const MCP_CALL_TIMEOUT_MS = 5000;

/** Retries after the first attempt, for transient failures only. */
export const MCP_MAX_RETRIES = 2;
/** First retry waits about this long; each next one doubles it, plus jitter. */
export const MCP_BACKOFF_BASE_MS = 400;
/** Jitter added to every backoff and every spacing wait, as a fraction (0 to 1). */
export const MCP_JITTER_FRACTION = 0.25;

/** At most this many calls in flight at once. */
export const MCP_MAX_CONCURRENT = 2;
/** About one request a second, jittered upwards. */
export const MCP_MIN_INTERVAL_MS = 1000;

/** This many failures in a row open the circuit. */
export const MCP_CIRCUIT_FAILURE_THRESHOLD = 3;
/** And it stays open this long. */
export const MCP_CIRCUIT_OPEN_MS = 60_000;

/** Used when KIWI_MCP_DAILY_BUDGET is not set (env.ts holds the same default). */
export const MCP_DEFAULT_DAILY_BUDGET = 200;
