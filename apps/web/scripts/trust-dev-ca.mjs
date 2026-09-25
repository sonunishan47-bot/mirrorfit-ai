/**
 * Installs the local development CA into the current Windows user's
 * Trusted Root store. Uses the generated path so the operator never has
 * to guess `web\.certs` versus `web.certs`.
 *
 * Does not print certificate contents or private keys.
 */

import { spawnSync } from 'node:child_process';

import { ensureDevCerts } from './ensure-dev-certs.mjs';

const { caPath, hosts } = await ensureDevCerts();

console.log(`CA file: ${caPath}`);
console.log(`Named hosts: ${hosts.join(', ')}`);

if (process.platform !== 'win32') {
  console.log('Not Windows. Install this CA in the OS trust store, then trust it on the iPhone.');
  process.exit(0);
}

const result = spawnSync('certutil', ['-addstore', '-user', 'Root', caPath], {
  encoding: 'utf8',
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log('Installed for the current Windows user Trusted Root store.');
console.log('Restart the kiosk browser, then open https://172.20.10.10:3111/mirror');
console.log('On iPhone Safari: open http://172.20.10.10:3112/dev-ca (HTTP, public CA only).');
console.log('Install the profile: Settings → General → VPN & Device Management.');
console.log('Then enable trust: Settings → General → About → Certificate Trust Settings.');
