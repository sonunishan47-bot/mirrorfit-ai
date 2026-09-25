/**
 * Pairing URL vocabulary shared by the server that mints a QR and the
 * kiosk that renders one.
 *
 * Kept free of `server-only` so the glass can validate a URL before drawing
 * it. The minting function stays in `pairing.ts` and still takes the token
 * from the server, never from the client.
 */

export const PAIRING_PATH = '/s';
export const PAIRING_TOKEN_PARAM = 't';

const PAIRING_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export interface ParsedPairingUrl {
  readonly url: string;
  readonly token: string;
}

export type PairingSearchInspection =
  | { readonly kind: 'missing' }
  | { readonly kind: 'malformed' }
  | { readonly kind: 'ok'; readonly token: string };

/**
 * The token shape the claim route accepts. One regex, used by the kiosk QR
 * and by `/s` so a phone cannot invent a second idea of "valid".
 */
export function parsePairingToken(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string' || !PAIRING_TOKEN.test(raw)) {
    return null;
  }
  return raw;
}

/**
 * Reads `t` from a query string and validates it through `parsePairingUrl`.
 *
 * Extra keys in the incoming search are ignored: the QR we mint never has
 * them, and a customer who arrives with `?t=…&utm=…` should still pair.
 */
export function inspectPairingSearch(origin: string, search: string): PairingSearchInspection {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const raw = params.get(PAIRING_TOKEN_PARAM);
  if (raw === null || raw === '') {
    return { kind: 'missing' };
  }

  let url: URL;
  try {
    url = new URL(PAIRING_PATH, origin.endsWith('/') ? origin : `${origin}/`);
  } catch {
    return { kind: 'malformed' };
  }
  url.search = '';
  url.searchParams.set(PAIRING_TOKEN_PARAM, raw);
  const parsed = parsePairingUrl(url.toString());
  return parsed ? { kind: 'ok', token: parsed.token } : { kind: 'malformed' };
}

/**
 * Accepts only the URL shape the create-session route returns: `/s?t=…`.
 *
 * Anything else — extra query keys, a path that is not `/s`, a short token —
 * is rejected so the kiosk cannot draw a QR that would send a phone to the
 * wrong place, or worse, encode a device secret.
 */
export function parsePairingUrl(raw: string): ParsedPairingUrl | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  if (url.pathname !== PAIRING_PATH) {
    return null;
  }

  const keys = [...url.searchParams.keys()];
  if (keys.length !== 1 || keys[0] !== PAIRING_TOKEN_PARAM) {
    return null;
  }

  const token = parsePairingToken(url.searchParams.get(PAIRING_TOKEN_PARAM));
  if (!token) {
    return null;
  }

  return { url: url.toString(), token };
}

/** True when a pairing URL accidentally contains a device secret. */
export function pairingUrlLeaksSecret(pairingUrl: string, secret: string): boolean {
  return secret.length > 0 && pairingUrl.includes(secret);
}
