import 'server-only';

import { createClient } from '@supabase/supabase-js';
import { clientEnv } from '@/env/client';
import { getServerEnv } from '@/env/server';
import type { Database } from './database.types';

/**
 * Privileged Supabase client. Bypasses RLS entirely.
 *
 * Rules for using this:
 *   1. Never in a client component, and never in a shared module that one
 *      might import. The `server-only` guard enforces this at build time.
 *   2. Authorize the caller first. This client cannot tell whose request it is
 *      serving, so tenancy checks must already have happened.
 *   3. Never filter by an organization, shop or display id that came from the
 *      client. Resolve those server-side from the authenticated identity.
 *
 * Intended for the narrow set of operations RLS cannot express: device
 * pairing-token verification, heartbeat ingestion, and audit writes.
 */
export function createSupabaseAdminClient() {
  const { SUPABASE_SECRET_KEY } = getServerEnv();

  return createClient<Database>(clientEnv.NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
