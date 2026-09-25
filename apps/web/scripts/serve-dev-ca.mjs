/**
 * HTTP-only download of the public local-dev CA.
 *
 * Safari cannot open https://172.20.10.10:3111/dev-ca until it already
 * trusts this CA. Serving the public certificate on a separate HTTP port
 * is the install path. The private key is never read. TLS on port 3111
 * is not weakened.
 */

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

export const DEV_CA_HTTP_PORT = Number(process.env.DEV_CA_HTTP_PORT ?? 3112);

export function respondDevCa(method, pathname, readCa) {
  if (method !== 'GET' && method !== 'HEAD') {
    return { status: 405, body: null, headers: { Allow: 'GET, HEAD' } };
  }
  if (pathname !== '/' && pathname !== '/dev-ca') {
    return { status: 404, body: null, headers: {} };
  }

  const cert = readCa();
  if (!cert) {
    return { status: 404, body: null, headers: {} };
  }

  return {
    status: 200,
    body: method === 'HEAD' ? null : cert,
    headers: {
      'Content-Type': 'application/x-x509-ca-cert',
      'Content-Disposition': 'inline; filename="mirrorfit-dev-ca.crt"',
      'Cache-Control': 'no-store',
    },
  };
}

export function startDevCaHttpServer(caPath, port = DEV_CA_HTTP_PORT) {
  const server = createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
    const result = respondDevCa(req.method ?? 'GET', pathname, () => {
      try {
        return readFileSync(caPath);
      } catch {
        return null;
      }
    });
    res.writeHead(result.status, result.headers);
    res.end(result.body ?? undefined);
  });

  server.listen(port, '0.0.0.0');
  return server;
}
