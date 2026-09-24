import next from 'eslint-config-next';
import tseslint from 'typescript-eslint';

/**
 * Flat ESLint config for the workspace.
 *
 * Type-aware rules are enabled deliberately. `no-floating-promises` and
 * `no-misused-promises` catch exactly the failure mode that matters most in a
 * realtime pipeline: an un-awaited send or teardown that leaves a session in a
 * half-closed state.
 */
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/coverage/**',
      '**/next-env.d.ts',
      // Emitted by `supabase gen types`; not ours to satisfy.
      '**/database.types.ts',
    ],
  },

  ...tseslint.configs.recommendedTypeChecked,

  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Surfacing an unhandled rejection as a lint error is cheaper than
      // finding it as a stuck mirror in a store.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
    },
  },

  // Next.js rules apply only to the app, not to the framework-agnostic packages.
  ...next.map((config) => ({
    ...config,
    files: ['apps/web/**/*.ts', 'apps/web/**/*.tsx'],
  })),
  {
    files: ['apps/web/**/*.ts', 'apps/web/**/*.tsx'],
    rules: {
      // Pages Router rule; this app is App Router only, and leaving it on
      // makes the rule scan for a `pages/` directory that will never exist.
      '@next/next/no-html-link-for-pages': 'off',
    },
  },

  // Build and test tooling lives outside the TypeScript projects, so the
  // type-aware rules have no program to resolve it against.
  {
    files: ['**/*.config.{js,mjs,ts}', 'eslint.config.mjs', 'vitest.server-only.ts'],
    ...tseslint.configs.disableTypeChecked,
  },
);
