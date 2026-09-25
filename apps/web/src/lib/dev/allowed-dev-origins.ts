/**
 * Hostnames the Next.js *dev* server may serve `/_next` assets to.
 *
 * Next 16 `blockCrossSiteDEV` allows `localhost` only by default. Opening
 * `/mirror` at a LAN address still returns the SSR HTML, but any
 * Origin-bearing request for `/_next/*` — including the HMR websocket —
 * is answered `403 Unauthorized`. React never hydrates, so the unenrolled
 * panel's `type="button"` handler never attaches and "Enroll this mirror"
 * does nothing.
 *
 * Production `next start` does not consult this list.
 *
 * Entries are hostnames only (no scheme, no port), matching
 * https://nextjs.org/docs/app/api-reference/config/next-config-js/allowedDevOrigins
 */
export const ALLOWED_DEV_ORIGINS = [
  '127.0.0.1',
  '10.*.*.*',
  '192.168.*.*',
  '172.16.*.*',
  '172.17.*.*',
  '172.18.*.*',
  '172.19.*.*',
  '172.20.*.*',
  '172.21.*.*',
  '172.22.*.*',
  '172.23.*.*',
  '172.24.*.*',
  '172.25.*.*',
  '172.26.*.*',
  '172.27.*.*',
  '172.28.*.*',
  '172.29.*.*',
  '172.30.*.*',
  '172.31.*.*',
] as const;

/**
 * Same matching rules Next uses for `allowedDevOrigins`: an exact hostname
 * or `*` / `**` labels. Kept here so a test can lock the list to the LAN
 * hosts Phase 4 actually opens, without importing Next internals.
 */
export function matchesAllowedDevOrigin(
  hostname: string,
  allowed: readonly string[] = ALLOWED_DEV_ORIGINS,
): boolean {
  const origin = asciiLower(hostname);
  return allowed.some((entry) => {
    const pattern = asciiLower(entry);
    return pattern === origin || matchWildcardDomain(origin, pattern);
  });
}

function asciiLower(value: string): string {
  return value.replace(/[A-Z]/g, (char) => char.toLowerCase());
}

function matchWildcardDomain(domain: string, pattern: string): boolean {
  const domainParts = domain.split('.');
  const patternParts = pattern.split('.');

  if (patternParts.length < 1) return false;
  if (domainParts.length < patternParts.length) return false;
  if (patternParts.length === 1 && (patternParts[0] === '*' || patternParts[0] === '**')) {
    return false;
  }

  while (patternParts.length) {
    const patternPart = patternParts.pop();
    const domainPart = domainParts.pop();

    if (patternPart === '') return false;
    if (patternPart === '*') {
      if (!domainPart) return false;
      continue;
    }
    if (patternPart === '**') {
      if (patternParts.length > 0) return false;
      return domainPart !== undefined;
    }
    if (domainPart !== patternPart) return false;
  }

  return domainParts.length === 0;
}
