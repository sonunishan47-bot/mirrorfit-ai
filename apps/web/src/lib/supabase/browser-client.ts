import { createBrowserClient } from '@supabase/ssr';
import { clientEnv } from '@/env/client';

/**
 * Supabase client for browser code.
 *
 * Uses the publishable key, so every query it makes is subject to RLS. This is
 * the only Supabase client that may appear in a client component.
 *
 * TODO (Phase 2): parameterise with generated `Database` types once the schema
 * and migrations exist.
 */
export function createSupabaseBrowserClient() {
  return createBrowserClient(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}
