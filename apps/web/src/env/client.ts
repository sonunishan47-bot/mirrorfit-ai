import { z } from 'zod';

/**
 * Environment available to browser code.
 *
 * Only `NEXT_PUBLIC_*` variables belong here, and every one of them is
 * assumed to be world-readable once the bundle ships. Nothing secret may ever
 * be added to this file.
 *
 * The `process.env.X` references are written out literally because Next
 * inlines public variables by static analysis; destructuring or dynamic keys
 * would silently produce `undefined` in the browser.
 */
const clientEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  /**
   * Publishable key. Safe to expose: it carries no privileges beyond what RLS
   * grants to an anonymous request.
   */
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
});

const parsed = clientEnvSchema.safeParse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
});

if (!parsed.success) {
  const fields = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
  throw new Error(
    `Invalid or missing public environment variables: ${fields}. ` +
      'Copy .env.example to apps/web/.env.local and fill it in.',
  );
}

export const clientEnv = parsed.data;
