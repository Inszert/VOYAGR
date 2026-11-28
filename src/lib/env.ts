import { z } from 'zod';
import { AppError } from './errors';

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

/**
 * `absent` is a slot with no data source behind it: the adapter answers with
 * nothing and the cost line is `excluded`. It is what production resolves
 * hotels, transfers and places to until a live adapter exists - see
 * `productionAwareDefaults` and `src/providers/absent.ts`.
 */
const providerName = z.enum(['mock', 'live', 'absent']).default('mock');

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

  /*
   * How often the worker re-prices what the front pages show, in minutes.
   *
   * Together with the target list in `src/cache/targets.ts` this is the whole
   * of the provider quota the background refresh spends; the arithmetic is in
   * `docs/architecture.md`, "Caching and refresh". The default is 480: three rounds a day.
   */
  PRICE_REFRESH_MINUTES: z.coerce.number().int().min(1).max(1440).default(480),
  /**
   * Kill switch for the background discovery refresh. Unset means on. `false` on the worker
   * schedules no round at all: not the interval, not the start-up round, not the 00:00 UTC
   * rollover round. Places pre-warming (Wikidata) is a separate schedule and is unaffected.
   */
  DISCOVERY_REFRESH_ENABLED: booleanish.default(true),
  /**
   * How often the worker pre-warms things to do for the catalogue, in hours.
   *
   * Long on purpose: the answers are cached for a week, and Wikidata's query
   * service asks to be asked rarely. Each round covers at most 40 destinations
   * that are not already fresh.
   */
  PLACES_REFRESH_HOURS: z.coerce.number().int().min(1).max(720).default(168),

  /** How many days either side of the chosen ones the flexible-dates strip shows. */
  FLEX_DAYS: z.coerce.number().int().min(0).max(7).default(3),

  // AI — `mock` needs no credentials.
  AI_PROVIDER: z
    .enum(['mock', 'anthropic'])
    .default('mock')
    // Refused here rather than at the first request: with no adapter behind it,
    // accepting the value only moves the failure to startup, after validation
    // has already said the configuration is fine. Drop this when the adapter lands.
    .refine((value) => value !== 'anthropic', {
      message: 'anthropic is not implemented yet; leave AI_PROVIDER unset or set it to mock',
    }),
  AI_MODEL: z.string().min(1).default('claude-sonnet-5'),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),

  // Travel provider adapters.
  /**
   * Which flight adapter is active.
   *
   * `aviasales` is the Travelpayouts Data API. It needs `AVIASALES_API_TOKEN`;
   * without one the registry refuses to build it rather than starting up and
   * failing on the first search.
   */
  /**
   * `duffel` is deliberately not a valid value here.
   *
   * Binding project decision, 2026-11-04: no paid API, ever, with no
   * exception for a sandbox key. Duffel is a commercial, partner-gated
   * vendor and is prohibited outright, not merely "not enabled by
   * default". Removing it from this enum means `FLIGHT_PROVIDER=duffel`
   * fails environment validation before the process serves a single
   * request, the same way any other typo in this field already does -
   * there is no code path left that could read a Duffel credential or
   * reach `api.duffel.com`. See `docs/provider-policy.md`.
   */
  FLIGHT_PROVIDER: z.enum(['kiwi-mcp', 'mock', 'live', 'aviasales', 'liteapi']).default('kiwi-mcp'),
  /**
   * `kiwi-mcp` is the only flight source production accepts by default: the Kiwi.com MCP server
   * at https://mcp.kiwi.com, which needs no key. The older sources (`aviasales`, `liteapi`,
   * `live`) stay in the tree and keep working, but a production build refuses them unless this
   * is set - see `assertLegacyFlightProviderAllowed`. `mock` is governed by
   * `ALLOW_MOCK_IN_PRODUCTION`, as before.
   */
  ALLOW_LEGACY_FLIGHT_PROVIDERS: booleanish.default(false),
  /**
   * The most Kiwi MCP calls (attempts included) one process makes per UTC day, so a bug cannot
   * hammer a server that has no published rate limit. Conservative on purpose.
   */
  KIWI_MCP_DAILY_BUDGET: z.coerce.number().int().min(1).max(100000).default(200),
  /**
   * Offer the runtime API/MOCK switch.
   *
   * Deliberately optional rather than defaulted: unset means "on outside
   * production", which is what `dataSourceSwitchEnabled` reads. A default
   * here would make the flag look like a setting somebody has to manage.
   */
  DATA_SOURCE_SWITCH: booleanish.optional(),
  /**
   * Lets a production build serve fixtures. For the end-to-end suite, which
   * runs against `next start` and needs deterministic data, and for nothing
   * else: with this unset a production process refuses to start on a mock, and
   * the demo notices and the data-source switch can never appear.
   */
  ALLOW_MOCK_IN_PRODUCTION: booleanish.default(false),
  /**
   * Test-only. Makes the consented Drive script load a same-origin stub
   * (`/api/test/drive-stub`) instead of the vendor's host, so the end-to-end
   * suite can exercise the consent gating without contacting a third party.
   * Honoured only together with `ALLOW_MOCK_IN_PRODUCTION`; see
   * `src/consent/drive.ts`.
   */
  DRIVE_TEST_STUB: booleanish.default(false),
  HOTEL_PROVIDER: z.enum(['mock', 'live', 'absent', 'liteapi']).default('mock'),
  /**
   * Tours and activities. `liteapi` needs `LITEAPI_API_KEY`; the registry fails closed without it.
   * No adapter exists yet (migration plan Part 5), so today only `absent` is buildable.
   */
  EXPERIENCE_PROVIDER: z.enum(['absent', 'liteapi']).default('absent'),
  /**
   * `open-meteo` needs no credential - it is a free, keyless API - so unlike
   * the flight adapters above there is nothing to fail loudly about at
   * startup. See `src/providers/weather/open-meteo.ts` for the free-tier
   * terms this still depends on.
   */
  WEATHER_PROVIDER: z.enum(['mock', 'live', 'open-meteo']).default('open-meteo'),
  TRANSFER_PROVIDER: providerName,
  /**
   * `wikidata` needs no credential - the Wikidata Query Service is free and
   * keyless, and its data is CC0 - which is why it is the production default
   * where the other slots without a live adapter default to `absent`.
   */
  PLACES_PROVIDER: z.enum(['mock', 'live', 'absent', 'wikidata']).default('mock'),
  /**
   * Which exchange-rate source a search converts foreign quotes against.
   *
   * `ecb` needs no credential - free, keyless, published once a day by the
   * European Central Bank - which is why, unlike the flight and weather
   * providers above, it defaults *on* rather than to `mock`: it is fully
   * `APPROVED` under `docs/provider-policy.md`, not `PENDING`, so there is
   * no unresolved term standing between it and the default. `mock` resolves
   * to the honest empty table `src/core/fx.ts` already defaulted to - no
   * rate, so a foreign conversion fails and says so, rather than any
   * invented number. See `src/providers/fx/ecb.ts`.
   */
  FX_PROVIDER: z.enum(['mock', 'ecb']).default('ecb'),
  /**
   * Which accommodation providers to fan out across, in preference order.
   *
   * A list, not one name: stays merge across vendors, so the configuration
   * has to be able to say "all of these". Adding a provider later is a
   * deployment change. Defaults to the mock, which is the only adapter that
   * exists while Duffel Stays is not enabled on the account.
   */
  STAY_PROVIDERS: z.string().min(1).default('mock'),
  /**
   * The origin this deployment is reachable at, e.g. `https://voyagr.app`.
   *
   * Needed for absolute URLs a crawler can use - a sitemap of relative paths
   * is invalid. Optional, and when it is absent the sitemap is empty and
   * `robots.txt` simply does not point at one, which is better than pointing
   * at a wrong address.
   */
  PUBLIC_BASE_URL: z
    .string()
    .url()
    .optional()
    .transform((value) => value?.replace(/\/$/, '')),

  /*
   * Travelpayouts / Aviasales.
   *
   * Two values with different natures, and they are not both secrets. The
   * token authenticates us and must never leave the server. The partner
   * marker is an affiliate identifier that appears in the outbound links a
   * traveller clicks - it is public by design, so redacting it would be
   * theatre, and it is left out of `SECRET_ENV_KEYS` deliberately.
   */
  /*
   * No `DUFFEL` field here, deliberately. Duffel is a prohibited, paid
   * provider under the project's zero-billing policy (2026-11-04) - there
   * is nothing in this schema for a `DUFFEL=...` line to read, so it is
   * simply ignored rather than activating anything. The adapter still
   * exists at `src/providers/flights/duffel.ts`, unimported by the
   * registry, kept only as a historical reference. See
   * `docs/provider-policy.md`.
   */
  AVIASALES_API_TOKEN: z.string().min(1).optional(),
  AVIASALES_PARTNER_ID: z.string().min(1).optional(),

  /**
   * The Google Flights sidecar (`services/google-flights/`), an UNOFFICIAL scraper and an
   * owner-approved exception to `docs/provider-policy.md`. Off by default: with the URL unset
   * nothing can reach it, and setting it does nothing until the provider is selected. The key
   * is the shared secret the sidecar expects in `X-Voyagr-Sidecar-Key`.
   */
  GOOGLE_FLIGHTS_SIDECAR_URL: z.url().optional(),
  GOOGLE_FLIGHTS_SIDECAR_KEY: z.string().min(1).optional(),
  /**
   * The Travelpayouts hotel programme and campaign that "find a stay" links are
   * wrapped in. Both are public affiliate identifiers, like the marker. Neither
   * has a default: with either unset the link adapter is unavailable rather
   * than guessing an id.
   */
  /**
   * LiteAPI (hotel rates), the owner's chosen hotel source. A secret, sent as `X-API-Key`.
   * Unset, the adapter is absent and nothing else changes. A sandbox key returns sandbox
   * rates, which the adapter labels `test`, never `live`.
   */
  LITEAPI_API_KEY: z.string().min(1).optional(),
  /**
   * The nationality sent with every LiteAPI rates request (ISO 3166-1 alpha-2). It can change
   * the price, so it is configuration and not a guess buried in a request. Defaults to `US`.
   */
  LITEAPI_GUEST_NATIONALITY: z
    .string()
    .regex(/^[A-Za-z]{2}$/, 'must be a two-letter ISO country code')
    .transform((value) => value.toUpperCase())
    .default('US'),
  /**
   * A sandbox key (`sand_...`) returns test prices. In a production build it is refused unless
   * this is set explicitly, because setting it is the owner's decision to show test prices on
   * the live site (with a visible "Test prices" note). See `assertLiteApiKeyAllowed`.
   */
  LITEAPI_SANDBOX_IN_PRODUCTION: booleanish.default(false),
  /**
   * Demo mode: a visitor's flights and stays search may make live calls to the LiteAPI SANDBOX
   * when no stored row answers it. For local testing only. Never true in production: see
   * `demoLiveAllowed`, which also demands a sandbox key and a non-production app URL, and which
   * `parseEnv` enforces at start-up.
   */
  DEMO_MODE: booleanish.default(false),
  /**
   * The scheduled LiteAPI snapshot (`src/liteapi-snapshot/`). Off by default: it spends vendor
   * calls on a schedule, and ships off until the provider's terms allow periodic refresh. With
   * it off the worker starts no scheduler and the job makes no call. Visitors never call LiteAPI
   * either way; pages read the snapshot.
   */
  LITEAPI_SNAPSHOT_ENABLED: booleanish.default(false),
  /** The UTC hour the nightly past-departure cleanup is queued (once a day). It never calls a provider. */
  CLEANUP_UTC_HOUR: z.coerce.number().int().min(0).max(23).default(3),
  /** Refresh rounds a day, at fixed UTC slots (3 gives 00:00, 08:00 and 16:00). */
  LITEAPI_SNAPSHOT_REFRESHES_PER_DAY: z.coerce.number().int().min(1).max(24).default(3),
  /**
   * The departure cities the flight snapshot prices (`liteapi.flights.refresh`): a comma list
   * of three-letter IATA codes, airport or city. Each origin is priced to every launch
   * destination in every window, so every origin added costs up to 54 flight calls a day at
   * three refreshes. Only read by the worker, and only with `LITEAPI_SNAPSHOT_ENABLED`.
   */
  LITEAPI_SNAPSHOT_ORIGINS: z
    .string()
    .default('BUD,VIE,PRG,LON')
    .transform((value) =>
      value
        .split(',')
        .map((code) => code.trim().toUpperCase())
        .filter((code) => code.length > 0),
    )
    .refine(
      (codes) => codes.length > 0 && codes.every((code) => /^[A-Z]{3}$/.test(code)),
      'must be a comma list of three-letter IATA codes, such as BUD,VIE,PRG,LON',
    )
    .transform((codes) => [...new Set(codes)]),
  TRAVELPAYOUTS_HOTEL_PROGRAM_ID: z.string().min(1).optional(),
  TRAVELPAYOUTS_HOTEL_CAMPAIGN_ID: z.string().min(1).optional(),

  /*
   * Destination photographs. `none` is a supported state, not a degraded one:
   * the cards are designed to read without a picture. See
   * `docs/imagery-options.md` for why this source and no API key.
   */
  IMAGERY_PROVIDER: z.enum(['none', 'wikimedia']).default('wikimedia'),

  /**
   * Which email adapter is active. `console` - the default - writes a
   * verification link to the structured log instead of sending anything; see
   * `src/email/console.ts`. `resend` posts to Resend's HTTPS API and needs
   * `RESEND_API_KEY`. Production refuses `console` - see `src/email/registry.ts`.
   */
  EMAIL_PROVIDER: z.enum(['console', 'resend']).default('console'),
  RESEND_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().min(1).default('Voyagr <hello@voyagrfind.com>'),
  EMAIL_REPLY_TO: z.string().min(1).optional(),
  /** The sender's postal address, printed in the footer of every email. */
  EMAIL_POSTAL_ADDRESS: z.string().min(1).optional(),

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
  // The token, not the marker: see the note beside them above.
  'AVIASALES_API_TOKEN',
  'GOOGLE_FLIGHTS_SIDECAR_KEY',
  'LITEAPI_API_KEY',
  'VAPID_PRIVATE_KEY',
  'RESEND_API_KEY',
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

/**
 * Defaults that depend on where the process runs.
 *
 * Weather is keyless and real, so it is on everywhere except a test run, which
 * must not reach the network. In production the slots with no live adapter yet
 * default to `absent` rather than to a fixture, so a production config says what
 * it has - flights are the one slot with no safe default, and a `mock` there is
 * refused by the registry's guard rather than papered over here.
 */
function productionAwareDefaults(source: Record<string, unknown>): Record<string, unknown> {
  const production = source.NODE_ENV === 'production';

  return {
    WEATHER_PROVIDER: source.NODE_ENV === 'test' ? 'mock' : 'open-meteo',
    ...(production
      ? {
          HOTEL_PROVIDER: 'absent',
          TRANSFER_PROVIDER: 'absent',
          PLACES_PROVIDER: 'wikidata',
          STAY_PROVIDERS: 'absent',
        }
      : {}),
    ...source,
  };
}

/**
 * A production deployment must say where it lives.
 *
 * Verification and reset links are built from `NEXT_PUBLIC_APP_URL`. Its schema
 * default is localhost, which is right on a laptop and wrong on a server: a
 * production process that fell back to it would mail links that only work on
 * the machine that sent them. So production refuses to start without a public
 * origin, rather than sending the first email to nowhere.
 */
const LOOPBACK_HOSTNAME = /^(localhost|.+\.localhost|127(\.\d{1,3}){3}|\[::1\])$/;

const PRODUCTION_URL_HINT =
  'Production needs the public address of this site, such as https://example.com, ' +
  'because verification and reset links are built from it. ' +
  'Set it in the production environment and restart.';

function isLoopbackUrl(value: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(value).hostname;
  } catch {
    // Not a URL at all. The schema reports that with its own message.
    return false;
  }
  return LOOPBACK_HOSTNAME.test(hostname);
}

function assertProductionAppUrl(source: Record<string, unknown>): void {
  if (source.NODE_ENV !== 'production') return;

  const appUrl = source.NEXT_PUBLIC_APP_URL;

  if (appUrl === undefined) {
    throw new AppError(
      'CONFIGURATION_ERROR',
      `NEXT_PUBLIC_APP_URL is not set. ${PRODUCTION_URL_HINT}`,
      { context: { variable: 'NEXT_PUBLIC_APP_URL', problem: 'missing' } },
    );
  }

  if (typeof appUrl === 'string' && isLoopbackUrl(appUrl)) {
    throw new AppError(
      'CONFIGURATION_ERROR',
      `NEXT_PUBLIC_APP_URL points at this machine (localhost or 127.0.0.1). ${PRODUCTION_URL_HINT}`,
      { context: { variable: 'NEXT_PUBLIC_APP_URL', problem: 'loopback' } },
    );
  }
}

/**
 * Which LiteAPI environment a key belongs to. Derived, never configured: a key that starts with
 * `sand_` is a sandbox key. `null` when there is no key.
 */
export function liteApiEnvironment(
  env: Pick<Env, 'LITEAPI_API_KEY'>,
): 'sandbox' | 'production' | null {
  const key = env.LITEAPI_API_KEY;
  if (!key) return null;
  return key.startsWith('sand_') ? 'sandbox' : 'production';
}

/**
 * A sandbox key in a production build is refused unless `LITEAPI_SANDBOX_IN_PRODUCTION=true`.
 * Sandbox prices are test data; showing them on the live site is a decision, not a default.
 * The message never contains the key.
 */
function assertLiteApiKeyAllowed(source: Record<string, unknown>): void {
  if (source.NODE_ENV !== 'production') return;
  const key = source.LITEAPI_API_KEY;
  if (typeof key !== 'string' || !key.startsWith('sand_')) return;

  const flag = source.LITEAPI_SANDBOX_IN_PRODUCTION;
  if (flag === true || flag === 'true' || flag === '1') return;

  throw new AppError(
    'CONFIGURATION_ERROR',
    'LITEAPI_API_KEY is a sandbox key, and sandbox prices are test data. A production build ' +
      'refuses it unless LITEAPI_SANDBOX_IN_PRODUCTION=true is set, or a production key is used.',
    { context: { variable: 'LITEAPI_API_KEY', problem: 'sandbox_in_production' } },
  );
}

/** The production site's host. Demo mode refuses it and every host that ends with it. */
const PRODUCTION_HOST = 'voyagrfind.com';

export type DemoLiveVerdict =
  { readonly ok: true } | { readonly ok: false; readonly reason: string };

/**
 * May the demo live path (real LiteAPI sandbox calls from a visitor's search) run? Pure. Ok only
 * when DEMO_MODE is on, the key is a sandbox key (`sand_`), and the app URL is not the production
 * host. Otherwise a reason that never contains the key.
 */
export function demoLiveAllowed(
  env: Pick<Env, 'DEMO_MODE' | 'LITEAPI_API_KEY' | 'NEXT_PUBLIC_APP_URL'>,
): DemoLiveVerdict {
  if (env.DEMO_MODE !== true) {
    return { ok: false, reason: 'Demo live calls are off: DEMO_MODE is not true.' };
  }
  if (!env.LITEAPI_API_KEY || !env.LITEAPI_API_KEY.startsWith('sand_')) {
    return {
      ok: false,
      reason: 'Demo live calls need a LiteAPI sandbox key (LITEAPI_API_KEY starting with sand_).',
    };
  }
  let hostname: string;
  try {
    hostname = new URL(env.NEXT_PUBLIC_APP_URL).hostname.toLowerCase();
  } catch {
    return { ok: false, reason: 'Demo live calls are refused: the app URL is not a valid URL.' };
  }
  if (hostname === PRODUCTION_HOST || hostname.endsWith(PRODUCTION_HOST)) {
    return {
      ok: false,
      reason: `Demo live calls are refused on the production host (${PRODUCTION_HOST}).`,
    };
  }
  return { ok: true };
}

/**
 * A production build serves flights from the Kiwi MCP server only. The older sources stay
 * buildable, but choosing one there is a decision, not a leftover: refused unless
 * `ALLOW_LEGACY_FLIGHT_PROVIDERS=true`. `mock` is not handled here; the registry refuses it.
 */
function assertLegacyFlightProviderAllowed(source: Record<string, unknown>): void {
  if (source.NODE_ENV !== 'production') return;
  const chosen = source.FLIGHT_PROVIDER;
  if (chosen !== 'live' && chosen !== 'aviasales' && chosen !== 'liteapi') return;

  const flag = source.ALLOW_LEGACY_FLIGHT_PROVIDERS;
  if (flag === true || flag === 'true' || flag === '1') return;

  throw new AppError(
    'CONFIGURATION_ERROR',
    `FLIGHT_PROVIDER is "${chosen}", and production serves flights from kiwi-mcp only. ` +
      'Set FLIGHT_PROVIDER=kiwi-mcp, or ALLOW_LEGACY_FLIGHT_PROVIDERS=true to choose this one on purpose.',
    { context: { variable: 'FLIGHT_PROVIDER', problem: 'legacy_in_production' } },
  );
}

export function parseEnv(source: Record<string, string | undefined>): Env {
  const present = stripEmptyStrings(source);
  assertProductionAppUrl(present);
  assertLiteApiKeyAllowed(present);
  assertLegacyFlightProviderAllowed(present);

  const result = envSchema.safeParse(productionAwareDefaults(present));

  if (!result.success) {
    // Report which variable failed and why — never the offending value, which
    // may itself be a secret.
    const issues = result.error.issues.map(
      (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    throw new EnvValidationError(issues);
  }

  // Demo mode asked for, but not allowed here: refuse to start, saying why (never the key).
  if (result.data.DEMO_MODE) {
    const verdict = demoLiveAllowed(result.data);
    if (!verdict.ok) {
      throw new AppError('CONFIGURATION_ERROR', verdict.reason, {
        context: { variable: 'DEMO_MODE', problem: 'demo_not_allowed' },
      });
    }
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
  /** Destination photographs are fetched, rather than the cards going bare. */
  imagery: boolean;
}

/** Which capabilities the current configuration actually enables. */
export function getCapabilities(env: Env = getEnv()): EnvCapabilities {
  return {
    database: Boolean(env.DATABASE_URL),
    redis: Boolean(env.REDIS_URL),
    bullmq: env.QUEUE_DRIVER === 'bullmq' && Boolean(env.REDIS_URL),
    webPush: Boolean(env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY),
    liveAi: env.AI_PROVIDER !== 'mock' && Boolean(env.ANTHROPIC_API_KEY),
    imagery: env.IMAGERY_PROVIDER !== 'none',
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
