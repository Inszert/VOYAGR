/**
 * `npm run demo`: build the app and serve it on http://localhost:3200 in DEMO mode: flights and
 * stays come LIVE from the Nuitee (LiteAPI) SANDBOX. Sandbox prices are not real. Local testing
 * only; the app refuses to run this path on the production host or with a non-sandbox key
 * (`demoLiveAllowed` in src/lib/env.ts), and caps it at 200 live calls per process.
 *
 * The environment below is explicit and complete, and it wins over `.env`: Next never overwrites
 * a variable already in the process environment, and a blank value counts as present, so every
 * slot that must be off is set to an empty string rather than left out. The one thing taken from
 * `.env` is LITEAPI_API_KEY, read here without ever printing it and passed to the child only.
 *
 * What this guarantees: weather, places, FX, AI, email and transfers stay fixtures; there is no
 * database, no Redis and no background worker; the only vendor key in the process is the sandbox
 * key. Photographs use the real provider the app uses (Wikimedia).
 */
import { spawn, spawnSync } from 'node:child_process';

/*
 * Load .env into THIS process only to pick up the sandbox key. loadEnvFile never overwrites a
 * variable that is already set. Nothing here prints a value.
 */
// The environment as it was before .env: the child inherits this, never the rest of .env.
const BASE_ENV = { ...process.env };
try {
  process.loadEnvFile('.env');
} catch {
  // No .env: the key must then be in the environment already.
}
const SANDBOX_KEY = process.env.LITEAPI_API_KEY ?? '';
if (!SANDBOX_KEY.startsWith('sand_')) {
  console.error(
    'The demo needs LITEAPI_API_KEY (a sandbox key starting with sand_) in .env or the environment. Refusing to start.',
  );
  process.exit(1);
}

const PORT = 3200;
const URL_LOCAL = `http://localhost:${PORT}`;

const DEMO_ENV = {
  /*
   * `next start` is production. Production refuses an app URL that points at this machine
   * (src/lib/env.ts, assertProductionAppUrl), so the demo names a reserved, non-loopback host.
   * The value is only used to build absolute links in emails; nothing is ever fetched from it.
   */
  NEXT_PUBLIC_APP_URL: 'https://voyagr-demo.example.com',
  PUBLIC_BASE_URL: '',

  // Production refuses fixtures unless told; the end-to-end suite opts in the same way.
  ALLOW_MOCK_IN_PRODUCTION: 'true',
  DATA_SOURCE_SWITCH: 'false',
  DRIVE_TEST_STUB: 'true',

  // DEMO mode: live LiteAPI SANDBOX for flights, stays and hotels. Guarded in src/lib/env.ts.
  DEMO_MODE: 'true',
  FLIGHT_PROVIDER: 'liteapi',
  HOTEL_PROVIDER: 'liteapi',
  STAY_PROVIDERS: 'liteapi',
  // Every other slot is a fixture.
  EXPERIENCE_PROVIDER: 'absent',
  WEATHER_PROVIDER: 'mock',
  TRANSFER_PROVIDER: 'mock',
  PLACES_PROVIDER: 'mock',
  FX_PROVIDER: 'mock',
  AI_PROVIDER: 'mock',
  EMAIL_PROVIDER: 'console',
  // The real provider the app uses.
  IMAGERY_PROVIDER: 'wikimedia',

  // In-memory cache and queue: no Postgres, no Redis, no worker.
  DATABASE_URL: '',
  TEST_DATABASE_URL: '',
  REDIS_URL: '',
  QUEUE_DRIVER: 'memory',

  // Background work and snapshots off.
  DISCOVERY_REFRESH_ENABLED: 'false',
  LITEAPI_SNAPSHOT_ENABLED: 'false',
  // `next start` is a production build, which refuses a sandbox key unless told it is intended.
  LITEAPI_SANDBOX_IN_PRODUCTION: 'true',

  // The sandbox key is the only credential in this process. No other credential exists.
  LITEAPI_API_KEY: SANDBOX_KEY,
  AVIASALES_API_TOKEN: '',
  AVIASALES_PARTNER_ID: '',
  GOOGLE_FLIGHTS_SIDECAR_URL: '',
  GOOGLE_FLIGHTS_SIDECAR_KEY: '',
  TRAVELPAYOUTS_HOTEL_PROGRAM_ID: '',
  TRAVELPAYOUTS_HOTEL_CAMPAIGN_ID: '',
  ANTHROPIC_API_KEY: '',
  RESEND_API_KEY: '',
  DUFFEL: '',
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: '',
  VAPID_PRIVATE_KEY: '',

  // A separate build directory, so a demo build never overwrites a normal one.
  NEXT_DIST_DIR: '.next-demo',
  PORT: String(PORT),
};

const env = { ...BASE_ENV, ...DEMO_ENV };
const isWindows = process.platform === 'win32';

function run(command, args) {
  return spawn(command, args, { env, stdio: 'inherit', shell: isWindows });
}

function stop(child) {
  if (!child || child.exitCode !== null) return;
  if (isWindows) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
  else child.kill('SIGTERM');
}

let current = null;
let stopping = false;

function shutdown() {
  if (stopping) return;
  stopping = true;
  console.log('\nStopping the demo.');
  stop(current);
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

async function waitForReady() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(URL_LOCAL, { redirect: 'manual' });
      if (response.status < 500) return true;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

console.log(
  'DEMO mode: flights and stays use live Nuitee SANDBOX calls (test prices, local only).',
);
console.log('Building the demo...');
current = run('npm', ['run', 'build']);
current.on('exit', async (code) => {
  if (stopping) return;
  if (code !== 0) {
    console.error('The build failed; the demo was not started.');
    process.exit(code ?? 1);
  }
  current = run('npx', ['next', 'start', '--port', String(PORT)]);
  current.on('exit', (serverCode) => {
    if (!stopping) process.exit(serverCode ?? 0);
  });
  if (await waitForReady()) {
    console.log(`Voyagr demo ready: ${URL_LOCAL}/explore  (Ctrl+C to stop)`);
  } else {
    console.error('The demo server did not answer in time.');
    shutdown();
  }
});
