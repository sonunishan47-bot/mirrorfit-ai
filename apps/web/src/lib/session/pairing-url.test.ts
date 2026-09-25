import { describe, expect, it } from 'vitest';

import {
  inspectPairingSearch,
  pairingUrlLeaksSecret,
  parsePairingToken,
  parsePairingUrl,
} from './pairing-url';

const TOKEN = 'i'.repeat(43);
const SECRET = 'j'.repeat(43);

describe('pairing URL shape', () => {
  it('accepts /s?t= with a 43-character token', () => {
    const parsed = parsePairingUrl(`https://shop.example/s?t=${TOKEN}`);
    expect(parsed?.token).toBe(TOKEN);
  });

  it('accepts a 43-character token and rejects a short one', () => {
    expect(parsePairingToken(TOKEN)).toBe(TOKEN);
    expect(parsePairingToken('short')).toBeNull();
    expect(parsePairingToken(null)).toBeNull();
  });

  it('reads a valid t= from a phone query string', () => {
    expect(inspectPairingSearch('https://shop.example', `?t=${TOKEN}`)).toEqual({
      kind: 'ok',
      token: TOKEN,
    });
  });

  it('reports a missing token separately from a malformed one', () => {
    expect(inspectPairingSearch('https://shop.example', '')).toEqual({ kind: 'missing' });
    expect(inspectPairingSearch('https://shop.example', '?')).toEqual({ kind: 'missing' });
    expect(inspectPairingSearch('https://shop.example', '?t=short')).toEqual({
      kind: 'malformed',
    });
  });

  it('detects a leaked device secret', () => {
    expect(pairingUrlLeaksSecret(`https://shop.example/s?t=${SECRET}`, SECRET)).toBe(true);
    expect(pairingUrlLeaksSecret(`https://shop.example/s?t=${TOKEN}`, SECRET)).toBe(false);
  });
});
