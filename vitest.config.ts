import { existsSync, readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

/**
 * Load `TEST_DATABASE_URL` from `.env`, and nothing else.
 *
 * Deliberately one variable rather than the whole file. The suite's defining
 * property is that it passes with no database, and copying `DATABASE_URL` in
 * would quietly point `getRepositories()` at a real server for every test that
 * ever touched it - turning "no external services required" into a lie that
 * only shows up on someone else's machine.
 *
 * The repository contract tests opt in explicitly by reading this one variable.
 */
function loadTestDatabaseUrl(): void {
  if (process.env.TEST_DATABASE_URL || !existsSync('.env')) return;

  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const match = /^\s*TEST_DATABASE_URL\s*=\s*(.*)$/.exec(line);
    if (!match) continue;

    const value = match[1]?.trim().replace(/^["']|["']$/g, '');
    if (value) process.env.TEST_DATABASE_URL = value;
  }
}

loadTestDatabaseUrl();

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
