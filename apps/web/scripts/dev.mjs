/**
 * Local HTTPS Next.js dev server for Phase 4 kiosk verification.
 *
 * `getUserMedia` is only exposed on a secure origin. HTTP on a LAN IP is
 * not one. This wrapper mints a SAN certificate for localhost and this
 * machine's private addresses, then starts Next on port 3111.
 */

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

import { ensureDevCerts } from './ensure-dev-certs.mjs';
import { DEV_CA_HTTP_PORT, startDevCaHttpServer } from './serve-dev-ca.mjs';

const PORT = process.env.PORT ?? '3111';

const { keyPath, certPath, caPath, hosts } = await ensureDevCerts();
const lan = preferredLanHost(hosts);
const nextBin = createRequire(import.meta.url).resolve('next/dist/bin/next');

const caServer = startDevCaHttpServer(caPath);

console.log(`HTTPS kiosk hosts in this certificate: ${hosts.join(', ')}`);
console.log(`Open the physical mirror at https://${lan}:${PORT}/mirror`);
console.log('Trust the local CA once (Windows): pnpm.cmd --filter @mirrorfit/web trust-dev-ca');
console.log(`iPhone CA install (HTTP, before Safari trusts HTTPS): http://${lan}:${DEV_CA_HTTP_PORT}/dev-ca`);

const child = spawn(
  process.execPath,
  [
    nextBin,
    'dev',
    '--experimental-https',
    '--experimental-https-key',
    keyPath,
    '--experimental-https-cert',
    certPath,
    '--experimental-https-ca',
    caPath,
    '-p',
    PORT,
  ],
  { stdio: 'inherit' },
);

child.on('exit', (code, signal) => {
  caServer.close();
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});

function preferredLanHost(names) {
  return names.find((name) => name !== 'localhost' && name !== '127.0.0.1') ?? 'localhost';
}
