import { describe, expect, it } from 'vitest';

import { pairingQrSvg } from './qr-svg';

const TOKEN = 'g'.repeat(43);
const SECRET = 'h'.repeat(43);

describe('pairing QR svg', () => {
  it('draws an SVG from a pairing URL and does not embed the device secret', async () => {
    const url = `https://store.example/s?t=${TOKEN}`;
    const svg = await pairingQrSvg(url, SECRET);
    expect(svg).toContain('<svg');
    expect(svg).not.toContain(SECRET);
    expect(svg).not.toContain('Bearer');
  });

  it('does not draw a QR when the URL is missing or unsafe', async () => {
    expect(await pairingQrSvg(null, SECRET)).toBeNull();
    expect(await pairingQrSvg(`https://store.example/s?t=${SECRET}`, SECRET)).toBeNull();
  });
});
