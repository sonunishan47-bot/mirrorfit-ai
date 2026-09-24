import { createBrowserClient } from '@supabase/ssr';
import { clientEnv } from '@/env/client';
import type { Database } from './database.types';

/**
 * Supabase client for browser code.
 *
 * Uses the publishable key, so every query it makes is subject to RLS. This is
 * the only Supabase client that may appear in a client component.
 *
 * `sessions` and `device_credentials` must be queried with an explicit column
 * list. Both withhold a secret column at the grant level, which makes the
 * default `select('*')` fail with a permission error.
 */
export function createSupabaseBrowserClient() {
  return createBrowserClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}
