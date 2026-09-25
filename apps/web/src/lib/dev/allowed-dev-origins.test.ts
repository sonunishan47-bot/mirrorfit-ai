import { describe, expect, it } from 'vitest';

import { ALLOWED_DEV_ORIGINS, matchesAllowedDevOrigin } from './allowed-dev-origins';

describe('dev-server LAN origins', () => {
  it('covers the kiosk hosts Next otherwise 403s in development', () => {
    expect(matchesAllowedDevOrigin('172.20.10.10')).toBe(true);
    expect(matchesAllowedDevOrigin('127.0.0.1')).toBe(true);
    expect(matchesAllowedDevOrigin('192.168.1.50')).toBe(true);
    expect(matchesAllowedDevOrigin('10.0.0.8')).toBe(true);
  });

  it('does not open the allow-list to the public internet', () => {
    expect(matchesAllowedDevOrigin('example.com')).toBe(false);
    expect(matchesAllowedDevOrigin('8.8.8.8')).toBe(false);
    expect(matchesAllowedDevOrigin('172.32.0.1')).toBe(false);
  });

  it('is the list next.config hands to allowedDevOrigins', () => {
    expect(ALLOWED_DEV_ORIGINS).toContain('127.0.0.1');
    expect(ALLOWED_DEV_ORIGINS).toContain('172.20.*.*');
    expect(ALLOWED_DEV_ORIGINS).toContain('192.168.*.*');
    expect(ALLOWED_DEV_ORIGINS).toContain('10.*.*.*');
  });
});
