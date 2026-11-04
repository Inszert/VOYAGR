import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration.
 *
 * Runs against a production build rather than the dev server, because that is
 * what users get: the dev server has different caching, no minification, and the
 * service worker is deliberately disabled in development.
 *
 * `reuseExistingServer` is off in CI so a run can never silently test a stale
 * server someone left behind.
 */

const PORT = Number(process.env.PLAYWRIGHT_PORT ?? 3100);
const baseURL = `http://127.0.0.1:${PORT}`;
const isCI = Boolean(process.env.CI);

/**
 * Optional browser channel override.
 *
 * Playwright's bundled Chromium is the default and is what CI uses. Set
 * `PLAYWRIGHT_CHANNEL=chrome` (or `msedge`) to run against a locally installed
 * browser instead, which is the escape hatch for machines where the browser CDN
 * download is blocked. It changes which binary runs, never what is asserted.
 */
const channel = process.env.PLAYWRIGHT_CHANNEL;

export default defineConfig({
  testDir: './tests/e2e',
  // Tests must not depend on each other's state.
  fullyParallel: true,
  // A stray `test.only` reaching CI would silently skip the suite.
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: isCI ? 1 : undefined,
  timeout: 30_000,
  expect: { timeout: 10_000 },

  reporter: isCI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL,
    // Trace is the primary debugging artifact: it carries the DOM, network and
    // console, and needs no extra binaries.
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // Video is opt-in via PLAYWRIGHT_VIDEO=1. It requires Playwright's bundled
    // ffmpeg, which is a separate download, so leaving it on by default makes
    // the suite fail for a missing artifact encoder rather than a real defect.
    video: process.env.PLAYWRIGHT_VIDEO ? 'retain-on-failure' : 'off',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], ...(channel ? { channel } : {}) },
    },
    {
      // A mobile viewport is not optional for a PWA.
      name: 'mobile-chrome',
      use: { ...devices['Pixel 7'], ...(channel ? { channel } : {}) },
    },
  ],

  webServer: {
    // `npm run build`, not `npx next build`: the build has a `prebuild` step
    // that copies MapLibre's worker into `public/`, and without it the globe
    // renders an empty ocean and no test notices.
    command: `npm run build && npx next start --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: !isCI,
    // A cold production build is slow on first run.
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
    /*
     * Hermetic on purpose.
     *
     * Next loads `.env` automatically, so on a machine with real Postgres and
     * Redis configured the suite would sign accounts up into the developer's
     * own database and queue jobs onto their Redis - polluting both, and making
     * the run depend on whoever happens to have what configured.
     *
     * These are blanked rather than unset because `parseEnv` already treats an
     * empty string as absent, and because Next will not overwrite a variable
     * that is already present in the process environment.
     */
    env: {
      DATABASE_URL: '',
      TEST_DATABASE_URL: '',
      REDIS_URL: '',
      QUEUE_DRIVER: 'memory',
      /*
       * The providers too, and for the same reason.
       *
       * A developer with `FLIGHT_PROVIDER=aviasales` in their `.env` would
       * otherwise have this suite make live vendor calls: slow, rate
       * limited, and different on every run - against assertions written
       * for deterministic fixtures. The credential is blanked as well, so
       * the registry cannot be talked into a live adapter by a variable
       * that survived. (Duffel is prohibited outright and has no
       * `FLIGHT_PROVIDER` value left to select it with - `DUFFEL` below is
       * blanked only because nothing should be left relying on a variable
       * the schema no longer even reads.)
       */
      /*
       * The data-source switch is on, so the suite can assert on it.
       *
       * `next start` runs in production mode, where the switch hides itself.
       * Turning it on here is what the flag is for - and it is also the
       * shape a deployment would use to expose it deliberately.
       */
      DATA_SOURCE_SWITCH: 'true',
      FLIGHT_PROVIDER: 'mock',
      HOTEL_PROVIDER: 'mock',
      WEATHER_PROVIDER: 'mock',
      TRANSFER_PROVIDER: 'mock',
      PLACES_PROVIDER: 'mock',
      /*
       * Same reasoning as the other providers, caught by actually running
       * this suite rather than assumed: FX_PROVIDER defaults to 'ecb'
       * (src/lib/env.ts), and left unset here the suite made a real request
       * to the ECB's feed on first use, observed in this server's own log.
       * Free and harmless on its own, but it is still a live vendor call
       * from a suite whose whole point is to need none - a CI runner with
       * no outbound network would see this as a (gracefully degraded, but
       * real) difference in behaviour. 'mock' keeps the suite hermetic.
       */
      FX_PROVIDER: 'mock',
      DUFFEL: '',
      AVIASALES_API_TOKEN: '',
      // Blanked too, so the suite behaves the same whether or not the person
      // running it has generated keys. Subscribing for real would reach a push
      // service, which is neither fast nor hermetic; the configured control is
      // covered by a component test instead.
      NEXT_PUBLIC_VAPID_PUBLIC_KEY: '',
      VAPID_PRIVATE_KEY: '',
      /*
       * No photographs during the suite.
       *
       * Every page render would otherwise resolve sixteen destination images
       * from Wikimedia and every page load would fetch them through our proxy,
       * which makes the run depend on a third party being up and fast, and
       * makes `networkidle` a lottery. `docs/imagery-options.md` is explicit
       * that the tests must not need the network.
       *
       * What this leaves untested is only whether a photograph appears. That
       * the page is correct *without* one is the property that matters here,
       * and switching imagery off is how the suite asserts it on every page.
       */
      IMAGERY_PROVIDER: 'none',
    },
  },
});
