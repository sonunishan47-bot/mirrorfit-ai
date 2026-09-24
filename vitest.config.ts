import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // See vitest.server-only.ts for why this is needed.
      'server-only': fileURLToPath(new URL('./vitest.server-only.ts', import.meta.url)),
    },
  },
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/web/src/**/*.test.ts'],
    environment: 'node',
    // Fail rather than silently pass if a filter matches nothing.
    passWithNoTests: false,
  },
});
