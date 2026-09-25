import 'server-only';

import { PAIRING_PATH, PAIRING_TOKEN_PARAM } from './pairing-url';

export { PAIRING_PATH, PAIRING_TOKEN_PARAM };

/**
 * How long a QR code stays scannable by default.
 *
 * Long enough that someone can notice the mirror, walk over and scan it;
 * short enough that a photograph of an unattended screen is worthless within
 * a couple of minutes.
 */
export const DEFAULT_PAIRING_TTL_SECONDS = 120;

/**
 * Absolute URL to encode in the QR code.
 *
 * Next reconstructs `request.url` from the address the process bound
 * (`localhost` in `next dev`), not from the Host the kiosk used. A mirror
 * opened at http://172.20.10.10:3111 would otherwise mint
 * http://localhost:3111/s?t=…, which a phone reads as itself.
 *
 * The Host (and a matching Origin, for the scheme) is the kiosk's own view
 * of the server. Only the authenticated create-session caller receives this
 * URL, so a spoofed Host poisons that caller's QR and nothing else. A
 * mismatched Origin is ignored. `x-forwarded-host` is not read: on a bare
 * Next process a client can set it.
 */
export function buildPairingUrl(request: Request, token: string): string {
  const url = new URL(PAIRING_PATH, pairingOriginFromRequest(request));
  url.searchParams.set(PAIRING_TOKEN_PARAM, token);
  return url.toString();
}

const REQUEST_HOST =
  /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*|localhost|\d{1,3}(?:\.\d{1,3}){3})(?::\d{1,5})?$/;

export function pairingOriginFromRequest(request: Request): string {
  const fallback = new URL(request.url);
  const host = parseRequestHost(request.headers.get('host'));
  const origin = parseRequestOrigin(request.headers.get('origin'));

  if (origin && host && origin.host.toLowerCase() === host.toLowerCase()) {
    return origin.origin;
  }
  if (host) {
    return `${requestScheme(request, fallback)}://${host}`;
  }
  return fallback.origin;
}

function requestScheme(request: Request, fallback: URL): 'http' | 'https' {
  const forwarded = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase();
  if (forwarded === 'https' || forwarded === 'http') {
    return forwarded;
  }
  return fallback.protocol === 'https:' ? 'https' : 'http';
}

function parseRequestHost(raw: string | null): string | null {
  if (!raw) return null;
  const host = raw.trim();
  return REQUEST_HOST.test(host) ? host : null;
}

function parseRequestOrigin(raw: string | null): URL | null {
  if (!raw || raw === 'null') return null;
  try {
    const origin = new URL(raw);
    if (origin.protocol !== 'http:' && origin.protocol !== 'https:') return null;
    if (origin.username || origin.password) return null;
    if (origin.pathname !== '/' || origin.search || origin.hash) return null;
    return origin;
  } catch {
    return null;
  }
}
