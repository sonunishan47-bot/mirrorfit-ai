import { describe, expect, it } from 'vitest';

import { respondDevCa } from '../../../scripts/serve-dev-ca.mjs';

const CERT = Buffer.from('-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----\n');

describe('HTTP local-dev CA download', () => {
  it('serves the public CA on GET /dev-ca and GET /', () => {
    for (const path of ['/dev-ca', '/']) {
      const result = respondDevCa('GET', path, () => CERT);
      expect(result.status).toBe(200);
      expect(result.body).toEqual(CERT);
      expect(result.headers['Content-Type']).toBe('application/x-x509-ca-cert');
    }
  });

  it('does not serve any other path', () => {
    expect(respondDevCa('GET', '/mirror', () => CERT).status).toBe(404);
    expect(respondDevCa('GET', '/s', () => CERT).status).toBe(404);
    expect(respondDevCa('POST', '/dev-ca', () => CERT).status).toBe(405);
  });

  it('returns 404 when the CA file is missing', () => {
    expect(respondDevCa('GET', '/dev-ca', () => null).status).toBe(404);
  });
});
