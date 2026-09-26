/**
 * Recovers a stuck local kiosk host after Turbopack / OneDrive corruption
 * or LAN IP drift invalidating the HTTPS SAN certificate.
 *
 * Usage (from repo root or apps/web):
 *   pnpm --filter @mirrorfit/web kiosk-recover
 *   pnpm --filter @mirrorfit/web kiosk-recover -- --force-certs
 *
 * Does not start the server — wipe/regen only, then run `pnpm dev` again.
 */

import { existsSync, rmSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { collectDevHttpsHosts } from './dev-https-hosts.mjs';
import { ensureDevCerts } from './ensure-dev-certs.mjs';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const forceCerts = process.argv.includes('--force-certs');

const turbopackDev = resolve(webRoot, '.next', 'dev');
const nextCache = resolve(webRoot, '.next', 'cache');

let wiped = 0;
for (const path of [turbopackDev, nextCache]) {
  if (!existsSync(path)) continue;
  rmSync(path, { recursive: true, force: true });
  console.log(`Removed ${path}`);
  wiped += 1;
}
if (wiped === 0) {
  console.log('No .next/dev or .next/cache directory to wipe.');
}

if (forceCerts) {
  const hostsPath = resolve(webRoot, '.certs', 'hosts.json');
  if (existsSync(hostsPath)) {
    rmSync(hostsPath, { force: true });
    console.log('Cleared .certs/hosts.json so the SAN cert will regenerate.');
  }
}

const hosts = collectDevHttpsHosts(networkInterfaces());
const certs = await ensureDevCerts();
console.log(`HTTPS SAN hosts: ${certs.hosts.join(', ')}`);
if (hosts.join(',') !== certs.hosts.join(',')) {
  console.log('Note: live interfaces and cert hosts differ — restart after recover.');
}
console.log('');
console.log('Next: pnpm --filter @mirrorfit/web dev');
console.log('If the phone IP changed, reinstall CA only if the CA file changed (rare).');
console.log('Re-open the mirror URL printed by dev.mjs (not a stale bookmark).');
