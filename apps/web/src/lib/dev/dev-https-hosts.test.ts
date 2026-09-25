import { describe, expect, it } from 'vitest';

import { collectDevHttpsHosts, isPrivateIPv4 } from '../../../scripts/dev-https-hosts.mjs';

describe('local HTTPS certificate hosts', () => {
  it('always names localhost and 127.0.0.1', () => {
    expect(collectDevHttpsHosts({})).toEqual(['localhost', '127.0.0.1']);
  });

  it('adds this machine private IPv4 addresses so a LAN kiosk cert matches', () => {
    const hosts = collectDevHttpsHosts({
      WiFi: [
        { address: '172.20.10.10', family: 'IPv4', internal: false },
        { address: 'fe80::1', family: 'IPv6', internal: false },
      ],
      Loopback: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
    });

    expect(hosts).toContain('172.20.10.10');
    expect(hosts).toContain('localhost');
    expect(isPrivateIPv4('172.20.10.10')).toBe(true);
    expect(isPrivateIPv4('8.8.8.8')).toBe(false);
  });
});
