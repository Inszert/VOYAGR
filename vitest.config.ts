import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

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
