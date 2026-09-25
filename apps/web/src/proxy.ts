import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

import { clientEnv } from '@/env/client';
import { isPublicPath } from '@/lib/auth/public-paths';

/**
 * Keeps the Supabase session alive across navigations.
 *
 * Supabase access tokens are short-lived. Without something refreshing them
 * on each request, a staff member gets signed out mid-task. The proxy is the
 * one place that can both read the request cookies and write cookies onto the
 * response, which is why the refresh lives here rather than in a layout.
 *
 * This is the `proxy` convention rather than the older `middleware` one,
 * which Next 16 deprecated. Same runtime position, current name.
 *
 * It deliberately does not make authorisation decisions. Being signed in is
 * not the same as being active staff with a role, and answering that question
 * needs a database read that belongs in `getStaffContext`. The proxy only
 * establishes whether there is a session at all, and sends anonymous traffic
 * to the login page so protected pages are not rendered just to redirect.
 *
 * Which paths skip that redirect lives in `public-paths.ts` so the kiosk
 * route and the unit tests cannot drift from this function.
 */

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Calling getUser() is what performs the refresh. Do not remove it or
  // replace it with getSession(): getSession() reads the cookie without
  // contacting the auth server, so it neither validates nor refreshes.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isPublicPath(request.nextUrl.pathname)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.search = '';
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and image files. Running the refresh on
     * an image request would triple the auth traffic for no benefit.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico)$).*)',
  ],
};
