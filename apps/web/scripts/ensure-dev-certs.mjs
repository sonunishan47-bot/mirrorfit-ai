/**
 * Writes a local CA and a SAN server certificate for kiosk HTTPS.
 *
 * The CA is stable across regenerations so Windows / iPhone only need to
 * trust it once. The server certificate is rebuilt when this machine's
 * private LAN addresses change.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generate } from 'selfsigned';

import { collectDevHttpsHosts } from './dev-https-hosts.mjs';

const CERT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '.certs');
const CA_KEY_PATH = resolve(CERT_DIR, 'dev-ca-key.pem');
const CA_CERT_PATH = resolve(CERT_DIR, 'dev-ca.crt');
const KEY_PATH = resolve(CERT_DIR, 'dev-key.pem');
const CERT_PATH = resolve(CERT_DIR, 'dev-cert.pem');
const HOSTS_PATH = resolve(CERT_DIR, 'hosts.json');

const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

export async function ensureDevCerts(interfaces = networkInterfaces()) {
  const hosts = collectDevHttpsHosts(interfaces);
  mkdirSync(CERT_DIR, { recursive: true });

  const ca = await ensureCa();
  if (certsMatchHosts(hosts)) {
    return { keyPath: KEY_PATH, certPath: CERT_PATH, caPath: CA_CERT_PATH, hosts };
  }

  const altNames = hosts.map((host) =>
    host === 'localhost' ? { type: 2, value: host } : { type: 7, ip: host },
  );

  const pems = await generate([{ name: 'commonName', value: 'MirrorFit local kiosk' }], {
    algorithm: 'sha256',
    notAfterDate: new Date(Date.now() + YEAR_MS),
    ca: { key: ca.key, cert: ca.cert },
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
      { name: 'extKeyUsage', serverAuth: true },
      { name: 'subjectAltName', altNames },
    ],
  });

  writeFileSync(KEY_PATH, pems.private, { encoding: 'utf8', mode: 0o600 });
  writeFileSync(CERT_PATH, pems.cert, { encoding: 'utf8' });
  writeFileSync(HOSTS_PATH, `${JSON.stringify(hosts, null, 2)}\n`, { encoding: 'utf8' });

  return { keyPath: KEY_PATH, certPath: CERT_PATH, caPath: CA_CERT_PATH, hosts };
}

async function ensureCa() {
  try {
    const key = readFileSync(CA_KEY_PATH, 'utf8');
    const cert = readFileSync(CA_CERT_PATH, 'utf8');
    if (key.includes('PRIVATE KEY') && cert.includes('BEGIN CERTIFICATE')) {
      return { key, cert };
    }
  } catch {
    // Mint a new CA below.
  }

  const pems = await generate([{ name: 'commonName', value: 'MirrorFit local dev CA' }], {
    algorithm: 'sha256',
    notAfterDate: new Date(Date.now() + 10 * YEAR_MS),
    extensions: [
      { name: 'basicConstraints', cA: true, pathLenConstraint: 0, critical: true },
      { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
    ],
  });

  writeFileSync(CA_KEY_PATH, pems.private, { encoding: 'utf8', mode: 0o600 });
  writeFileSync(CA_CERT_PATH, pems.cert, { encoding: 'utf8' });
  return { key: pems.private, cert: pems.cert };
}

function certsMatchHosts(hosts) {
  try {
    const recorded = JSON.parse(readFileSync(HOSTS_PATH, 'utf8'));
    if (!Array.isArray(recorded) || recorded.length !== hosts.length) return false;
    if (recorded.some((host, index) => host !== hosts[index])) return false;
    readFileSync(KEY_PATH);
    readFileSync(CERT_PATH);
    return true;
  } catch {
    return false;
  }
}
