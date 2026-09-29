import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const webRoot = resolve(import.meta.dirname, '../../..');

function source(relative: string): string {
  return readFileSync(resolve(webRoot, relative), 'utf8');
}

describe('try-on route boundaries', () => {
  it('authenticates the device before creating a job and does not trust tenant ids', () => {
    const route = source('src/app/api/device/tryon-jobs/route.ts');
    const service = source('src/lib/tryon/tryon-job-service.ts');
    expect(route.indexOf('authenticateDevice')).toBeLessThan(
      route.indexOf('readDeviceTryOnRequest'),
    );
    expect(route).not.toMatch(/organization_id|shop_id|display_id/);
    expect(service).toContain("kind: 'PHOTO_TRYON_UPLOAD'");
    expect(service).toContain('consent_id: consentId');
    expect(service).toContain('validateStillDimensions');
    expect(service).toContain('staleCompletionReason');
    expect(service).toContain('TRYON_PRIVATE_BUCKET');
    expect(service).not.toContain('garment-assets');
  });

  it('ends a session by deleting that session’s private stills', () => {
    const end = source('src/app/api/session/end/route.ts');
    expect(end).toContain('purgeTryOnAssetsForSession');
    expect(end.indexOf("rpc('end_display_session'")).toBeLessThan(
      end.indexOf('await purgeTryOnAssetsForSession'),
    );
  });

  it('authenticates the worker with the worker secret, not a staff cookie', () => {
    const claim = source('src/app/api/worker/tryon-jobs/claim/route.ts');
    const complete = source('src/app/api/worker/tryon-jobs/complete/route.ts');
    expect(claim).toContain('authorizeWorkerRequest');
    expect(complete).toContain('authorizeWorkerRequest');
    expect(claim).not.toContain('authenticateDevice');
    expect(`${claim}\n${complete}`).not.toMatch(/organization_id/);
  });

  it('does not let the phone catalog call the try-on job client', () => {
    const catalog = source('src/app/s/session-catalog.tsx');
    const phoneClient = source('src/lib/customer/catalog-client.ts');
    expect(`${catalog}\n${phoneClient}`).not.toMatch(/tryon-job-client|tryon-jobs/);
  });

  it('fails a missing model instead of painting a fake result', () => {
    const worker = source('scripts/tryon-worker.mjs');
    const provider = source('src/lib/tryon/vton-provider.ts');
    expect(worker).toContain('VTON_NOT_CONNECTED');
    expect(worker).toContain('The browser never calls the GPU');
    expect(provider).toContain('generateStill');
    expect(provider).toContain('WORKER_ENDPOINT_URL');
    expect(`${worker}\n${provider}`).not.toMatch(/createTestFixture|fillRect/i);
  });
});
