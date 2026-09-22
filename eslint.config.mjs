import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypeScript from 'eslint-config-next/typescript';
import prettierConfig from 'eslint-config-prettier';

/** @type {import('eslint').Linter.Config[]} */
const config = [
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'out/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'next-env.d.ts',
      'public/sw.js',
      // Copied out of node_modules by scripts/copy-map-worker.mjs. Vendor
      // bundles, not our source, and linting them says nothing about us.
      'public/maplibre/**',
    ],
  },

  ...nextCoreWebVitals,
  ...nextTypeScript,

  {
    rules: {
      // Underscore-prefixed args stay allowed so stub adapter implementations can
      // keep the full interface signature visible.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      // Application code logs through the structured logger, not console.
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },

  {
    // Infrastructure code legitimately reads raw process.env and writes to stdout.
    files: ['src/lib/env.ts', 'src/lib/logger.ts', 'scripts/**/*.mjs', '*.config.{ts,mjs,js}'],
    rules: {
      'no-console': 'off',
    },
  },

  {
    /*
     * Destination photographs are served by our own route, which is already a
     * cache in front of the source and hands back bytes the source's own
     * thumbnailer sized. Putting `next/image` in front of that adds a second
     * optimiser that re-fetches from us and cannot improve on what it gets,
     * and every one of these images is rendered with its intrinsic width and
     * height, so none of them shifts the layout the rule exists to protect.
     */
    files: [
      'src/components/discovery/destination-rail.tsx',
      'src/components/discovery/discovery-stage.tsx',
      'src/components/discovery/next-trip-band.tsx',
      'src/components/search/trip-card.tsx',
      'src/components/discovery/destination-header.tsx',
    ],
    rules: {
      '@next/next/no-img-element': 'off',
    },
  },

  {
    files: ['**/*.test.{ts,tsx}', 'tests/**/*.{ts,tsx}'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  prettierConfig,
];

export default config;
