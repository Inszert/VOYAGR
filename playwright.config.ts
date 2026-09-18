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
    command: `npx next build && npx next start --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: !isCI,
    // A cold production build is slow on first run.
    timeout: 180_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
