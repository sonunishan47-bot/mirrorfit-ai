import { describe, expect, it } from 'vitest';

import { buildPairingUrl, pairingOriginFromRequest } from './pairing';

const TOKEN = 'k'.repeat(43);

function request(url: string, headers: Record<string, string>): Request {
  return new Request(url, { headers });
}

describe('pairing URL origin', () => {
  it('uses the kiosk Host when Next reconstructs request.url as localhost', () => {
    const req = request('http://localhost:3111/api/session/create', {
      host: '172.20.10.10:3111',
      origin: 'http://172.20.10.10:3111',
    });

    expect(pairingOriginFromRequest(req)).toBe('http://172.20.10.10:3111');
    expect(buildPairingUrl(req, TOKEN)).toBe(`http://172.20.10.10:3111/s?t=${TOKEN}`);
  });

  it('uses the HTTPS LAN origin a physical kiosk actually opened', () => {
    const req = request('http://localhost:3111/api/session/create', {
      host: '172.20.10.10:3111',
      origin: 'https://172.20.10.10:3111',
    });

    expect(pairingOriginFromRequest(req)).toBe('https://172.20.10.10:3111');
    expect(buildPairingUrl(req, TOKEN)).toBe(`https://172.20.10.10:3111/s?t=${TOKEN}`);
  });

  it('uses https from request.url when the kiosk Host is the LAN address', () => {
    const req = request('https://localhost:3111/api/session/create', {
      host: '172.20.10.10:3111',
    });

    expect(pairingOriginFromRequest(req)).toBe('https://172.20.10.10:3111');
    expect(buildPairingUrl(req, TOKEN)).toBe(`https://172.20.10.10:3111/s?t=${TOKEN}`);
  });

  it('prefers a forwarded https scheme when Origin is absent', () => {
    const req = request('http://localhost:3111/api/session/create', {
      host: '172.20.10.10:3111',
      'x-forwarded-proto': 'https',
    });

    expect(pairingOriginFromRequest(req)).toBe('https://172.20.10.10:3111');
  });

  it('keeps localhost when the kiosk itself opened localhost', () => {
    const req = request('http://localhost:3111/api/session/create', {
      host: 'localhost:3111',
      origin: 'http://localhost:3111',
    });

    expect(buildPairingUrl(req, TOKEN)).toBe(`http://localhost:3111/s?t=${TOKEN}`);
  });

  it('does not adopt a mismatched Origin', () => {
    const req = request('http://localhost:3111/api/session/create', {
      host: '172.20.10.10:3111',
      origin: 'https://evil.example',
    });

    expect(pairingOriginFromRequest(req)).toBe('http://172.20.10.10:3111');
  });

  it('ignores a malformed Host and falls back to request.url', () => {
    const req = request('http://localhost:3111/api/session/create', {
      host: 'not a host/path',
    });

    expect(pairingOriginFromRequest(req)).toBe('http://localhost:3111');
  });
});
