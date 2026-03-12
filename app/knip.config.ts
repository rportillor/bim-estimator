import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  entry: [
    'client/src/main.tsx',
    'server/index.ts',
    'tests/**/*.test.{ts,tsx}',
    'tests/**/*.spec.{ts,tsx}'
  ],
  project: [
    'client/**/*.{ts,tsx}',
    'server/**/*.{ts,tsx}',
    'shared/**/*.{ts,tsx}',
    'tests/**/*.{ts,tsx}'
  ],
  ignore: [
    'dist/**',
    'coverage/**',
    'playwright-report/**',
    '**/*.config.{js,ts}',
    'vite.config.ts',
    'playwright.config.ts'
  ],
  ignoreDependencies: [
    '@replit/vite-plugin-cartographer',
    '@replit/vite-plugin-runtime-error-modal'
  ]
};

export default config;