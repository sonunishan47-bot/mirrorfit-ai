import 'server-only';

/**
 * Where a customer's phone lands after scanning the QR code on a mirror.
 *
 * Kept in one place because the mirror renders this into a QR code and the
 * phone route has to read it back; two independently written strings here
 * would be a pairing failure nobody could reproduce.
 */
export const PAIRING_PATH = '/s';
export const PAIRING_TOKEN_PARAM = 't';

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
 * The origin is taken from the request rather than from configuration, which
 * is safe here specifically because the only caller is an authenticated
 * mirror asking its own server: the URL is returned to the same client that
 * chose the host, so a spoofed `Host` header poisons nothing but the
 * attacker's own response. That reasoning stops holding the moment any other
 * caller can reach this, so it is written down rather than assumed.
 */
export function buildPairingUrl(request: Request, token: string): string {
  const url = new URL(PAIRING_PATH, new URL(request.url).origin);
  url.searchParams.set(PAIRING_TOKEN_PARAM, token);
  return url.toString();
}
