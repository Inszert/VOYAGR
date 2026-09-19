import { existsSync, readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

/**
 * Expose the connection strings in `.env` to tests as `TEST_*`, and nothing
 * else from that file.
 *
 * Deliberately an allow-list, and deliberately renamed. The suite's defining
 * property is that it passes with no external services; copying `DATABASE_URL`,
 * `REDIS_URL` or `QUEUE_DRIVER` through under their own names would quietly
 * point `getRepositories()` and `createQueueDriver()` at real servers for every
 * test that touches them, turning "no external services required" into a lie
 * that only shows up on someone else's machine.
 *
 * Integration tests opt in by reading a `TEST_*` variable explicitly, and skip
 * themselves when it is absent.
 */
/*
 * `TEST_DATABASE_URL` has no fallback, deliberately.
 *
 * The repository contract suite TRUNCATEs every table between tests. Falling
 * back to `DATABASE_URL` would mean that merely having a database configured is
 * enough for `npm test` to empty it - and the day that database is not a
 * development one, the mistake is unrecoverable. Pointing the tests at a
 * database has to be a thing someone typed on purpose.
 *
 * `TEST_REDIS_URL` may fall back, because the queue tests only ever create and
 * then obliterate queues under their own uniquely generated names, and touch
 * nothing that was already there.
 */
const TEST_ENV_KEYS = {
  TEST_DATABASE_URL: null,
  TEST_REDIS_URL: 'REDIS_URL',
} as const;

function readEnvFile(): Map<string, string> {
  const values = new Map<string, string>();
  if (!existsSync('.env')) return values;

  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match?.[1]) continue;

    const value = match[2]?.trim().replace(/^["']|["']$/g, '');
    if (value) values.set(match[1], value);
  }

  return values;
}

function loadTestEnv(): void {
  const values = readEnvFile();

  for (const [testKey, plainKey] of Object.entries(TEST_ENV_KEYS)) {
    if (process.env[testKey]) continue;

    // A dedicated TEST_* entry always wins, so a throwaway instance can be
    // pointed at without touching what the application itself uses.
    const value = values.get(testKey) ?? (plainKey ? values.get(plainKey) : undefined);
    if (value) process.env[testKey] = value;
  }
}

loadTestEnv();

/**
 * Vitest configuration.
 *
 * Two projects, because the deterministic core and the React components have
 * genuinely different needs: the core is pure Node and should stay fast, while
 * components need a DOM. Splitting them keeps a jsdom environment from being
 * paid for on every money-arithmetic test.
 *
 * Playwright owns `tests/e2e/`, so it is excluded here - running a Playwright
 * spec under Vitest produces a confusing failure rather than a useful one.
 */
export default defineConfig({
  plugins: [tsconfigPaths()],

  // The Next.js tsconfig sets `jsx: preserve` for the Next compiler; esbuild
  // needs to be told to actually transform JSX for tests.
  esbuild: {
    jsx: 'automatic',
  },

  test: {
    globals: true,
    passWithNoTests: false,
    exclude: ['**/node_modules/**', '**/.next/**', 'tests/e2e/**'],

    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'components',
          environment: 'jsdom',
          include: ['src/**/*.test.tsx'],
          setupFiles: ['./vitest.setup.ts'],
        },
      },
    ],

    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/app/**/layout.tsx',
        'src/app/**/page.tsx',
        'src/**/*.d.ts',
      ],
      thresholds: {
        // A floor, not a target. The deterministic core sits far above this;
        // the number exists to catch a regression that quietly drops tests.
        lines: 60,
        functions: 60,
        branches: 70,
        statements: 60,
      },
    },
  },
});
