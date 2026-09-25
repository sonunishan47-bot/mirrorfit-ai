import { describe, expect, it } from 'vitest';

import { pairingUrlLeaksSecret, parsePairingUrl } from './pairing-url';

const TOKEN = 'i'.repeat(43);
const SECRET = 'j'.repeat(43);

describe('pairing URL shape', () => {
  it('accepts /s?t= with a 43-character token', () => {
    const parsed = parsePairingUrl(`https://shop.example/s?t=${TOKEN}`);
    expect(parsed?.token).toBe(TOKEN);
  });

  it('detects a leaked device secret', () => {
    expect(pairingUrlLeaksSecret(`https://shop.example/s?t=${SECRET}`, SECRET)).toBe(true);
    expect(pairingUrlLeaksSecret(`https://shop.example/s?t=${TOKEN}`, SECRET)).toBe(false);
  });
});
