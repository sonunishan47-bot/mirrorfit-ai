import QRCode from 'qrcode';

import { pairingQrValue } from './pairing-qr';

/**
 * Renders a pairing URL as an SVG QR code.
 *
 * Returns null when the URL is not a pairing URL or when it contains a
 * device secret, so the glass cannot draw a credential or a fake code.
 */
export async function pairingQrSvg(
  pairingUrl: string | null,
  deviceSecret?: string | null,
): Promise<string | null> {
  const value = pairingQrValue(pairingUrl, deviceSecret);
  if (!value) return null;
  return QRCode.toString(value, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 1,
    color: { dark: '#000000', light: '#ffffff' },
  });
}
