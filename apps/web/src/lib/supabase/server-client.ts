import 'server-only';

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { clientEnv } from '@/env/client';

/**
 * Supabase client for server components, route handlers and server actions.
 *
 * Runs as the signed-in user with the publishable key, so RLS still applies.
 * Use this for anything acting on a staff member's behalf; reach for the admin
 * client only when an operation genuinely cannot be expressed under RLS.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Components cannot set cookies. Safe to ignore when a
            // middleware or route handler is responsible for refreshing the
            // session; harmful only if nothing else does, which is why session
            // refresh is centralised in middleware.
          }
        },
      },
    },
  );
}
