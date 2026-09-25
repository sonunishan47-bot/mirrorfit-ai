import { describe, expect, it } from 'vitest';

import { pairingQrValue } from './pairing-qr';

const TOKEN = 'c'.repeat(43);
const SECRET = 'd'.repeat(43);
const URL = `https://store.example/s?t=${TOKEN}`;

describe('pairing QR payload', () => {
  it('accepts the URL the create-session route returns', () => {
    expect(pairingQrValue(URL)).toBe(URL);
  });

  it('does not invent a QR when there is no pairing URL', () => {
    expect(pairingQrValue(null)).toBeNull();
    expect(pairingQrValue('')).toBeNull();
  });

  it('rejects a URL that is not /s?t=…', () => {
    expect(pairingQrValue('https://store.example/mirror')).toBeNull();
    expect(pairingQrValue(`https://store.example/s?t=${TOKEN}&extra=1`)).toBeNull();
    expect(pairingQrValue('https://store.example/s?t=short')).toBeNull();
  });

  it('refuses to encode a URL that contains the device secret', () => {
    const leaked = `https://store.example/s?t=${SECRET}`;
    expect(pairingQrValue(leaked, SECRET)).toBeNull();
  });

  it('does not put the device secret in a valid pairing URL', () => {
    const value = pairingQrValue(URL, SECRET);
    expect(value).toBe(URL);
    expect(value).not.toContain(SECRET);
  });
});
