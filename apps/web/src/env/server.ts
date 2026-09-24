import 'server-only';

import { z } from 'zod';

/**
 * Server-only environment.
 *
 * The `server-only` import above turns any accidental client import into a
 * build error, which is the mechanism that keeps the Supabase secret key out
 * of the browser bundle.
 *
 * Parsing is lazy rather than at module load so that `next build` succeeds on
 * a machine that has no secrets configured. A route that genuinely needs a
 * secret fails loudly at request time instead.
 */
const serverEnvSchema = z.object({
  /**
   * Full-privilege key that bypasses RLS. Only ever used by trusted server
   * code performing an operation that has already been authorized.
   */
  SUPABASE_SECRET_KEY: z.string().min(1),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | null = null;

export function getServerEnv(): ServerEnv {
  if (cached) return cached;

  const parsed = serverEnvSchema.safeParse({
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
  });

  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    // The names of the missing variables are safe to surface; their values are
    // never included.
    throw new Error(`Invalid or missing server environment variables: ${fields}`);
  }

  cached = parsed.data;
  return cached;
}
