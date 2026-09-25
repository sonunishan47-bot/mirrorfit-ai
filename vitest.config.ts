import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // See vitest.server-only.ts for why this is needed.
      'server-only': fileURLToPath(new URL('./vitest.server-only.ts', import.meta.url)),
      '@': fileURLToPath(new URL('./apps/web/src', import.meta.url)),
    },
  },
  test: {
    include: ['packages/*/src/**/*.test.ts', 'apps/web/src/**/*.test.ts'],
    environment: 'node',
    // Fail rather than silently pass if a filter matches nothing.
    passWithNoTests: false,
  },
});
