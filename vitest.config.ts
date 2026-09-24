import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/web/src/**/*.test.ts'],
    environment: 'node',
    // Fail rather than silently pass if a filter matches nothing.
    passWithNoTests: false,
  },
});
