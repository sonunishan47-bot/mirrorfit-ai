/**
 * Paths the session proxy must not send to /login.
 *
 * Staff pages are the ones that need a cookie. Everything else is either
 * public by nature (health) or authenticates with something that is not a
 * Supabase Auth user: a device bearer secret, a pairing token, or — for
 * `/mirror` — a kiosk that has not signed in and never will.
 */
export const PUBLIC_PATHS = [
  '/',
  '/login',
  '/api/health',
  '/api/device',
  '/api/session',
  '/s',
  '/mirror',
] as const;

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}
