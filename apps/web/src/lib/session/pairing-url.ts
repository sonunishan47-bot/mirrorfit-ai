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

  const token = url.searchParams.get(PAIRING_TOKEN_PARAM);
  if (!token || !PAIRING_TOKEN.test(token)) {
    return null;
  }

  return { url: url.toString(), token };
}

/** True when a pairing URL accidentally contains a device secret. */
export function pairingUrlLeaksSecret(pairingUrl: string, secret: string): boolean {
  return secret.length > 0 && pairingUrl.includes(secret);
}
