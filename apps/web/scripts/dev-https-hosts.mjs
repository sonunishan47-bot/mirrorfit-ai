/**
 * Hostnames / IPv4 addresses that a local HTTPS kiosk cert must name.
 *
 * Next's default `--experimental-https` certificate is localhost-only.
 * A physical mirror opened at https://172.20.10.10:3111 would then fail
 * name checks. Private LAN addresses from the current interfaces are
 * included so the same cert covers this machine's kiosk URL.
 */

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export function isPrivateIPv4(address) {
  const match = IPV4.exec(address);
  if (!match) return false;
  const octets = match.slice(1).map((part) => Number(part));
  if (octets.some((octet) => octet > 255)) return false;
  if (octets[0] === 10) return true;
  if (octets[0] === 192 && octets[1] === 168) return true;
  return octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31;
}

export function collectDevHttpsHosts(interfaces) {
  const hosts = new Set(['localhost', '127.0.0.1']);
  for (const entries of Object.values(interfaces ?? {})) {
    for (const entry of entries ?? []) {
      const family = entry.family;
      if (entry.internal) continue;
      if (family !== 'IPv4' && family !== 4) continue;
      if (isPrivateIPv4(entry.address)) {
        hosts.add(entry.address);
      }
    }
  }
  return [...hosts];
}
