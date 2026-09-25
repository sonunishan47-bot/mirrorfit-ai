import { pairingUrlLeaksSecret, parsePairingUrl } from '../session/pairing-url';

/**
 * Payload that may be drawn as a QR code on the glass.
 *
 * Returns null instead of a decorative stand-in when the URL is missing,
 * malformed, or contains a device secret. A fake QR would send a customer
 * to a dead page and hide a real pairing failure.
 */
export function pairingQrValue(
  pairingUrl: string | null,
  deviceSecret?: string | null,
): string | null {
  if (!pairingUrl) return null;
  const parsed = parsePairingUrl(pairingUrl);
  if (!parsed) return null;
  if (deviceSecret && pairingUrlLeaksSecret(parsed.url, deviceSecret)) {
    return null;
  }
  return parsed.url;
}
