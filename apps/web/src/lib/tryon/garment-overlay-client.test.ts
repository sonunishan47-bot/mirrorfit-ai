import { describe, expect, it, vi } from 'vitest';

import { fetchGarmentOverlay } from './garment-overlay-client';

const SECRET = 'e'.repeat(43);
const GARMENT = '11111111-1111-4111-8111-111111111111';
const VARIANT = '22222222-2222-4222-8222-222222222222';
const HASH = 'b'.repeat(64);

describe('fetchGarmentOverlay', () => {
  it('calls the device overlay route with a bearer and no tenancy fields', async () => {
    let url = '';
    let init: RequestInit | undefined;
    const overlay = await fetchGarmentOverlay(
      SECRET,
      GARMENT,
      VARIANT,
      async (input, requestInit) => {
        url = String(input);
        init = requestInit;
        return new Response(
          JSON.stringify({
            overlay_url: 'https://cdn.example/overlay.png?token=1',
            expires_in: 120,
            width: 400,
            height: 600,
            mime_type: 'image/png',
            version: 1,
            content_hash: HASH,
            garment_id: GARMENT,
            variant_id: VARIANT,
            anchor: { x: 0.5, y: 0.25 },
          }),
          { status: 200 },
        );
      },
    );

    expect(url).toContain('/api/device/garment-overlay?');
    expect(url).toContain(`garment_id=${GARMENT}`);
    expect(url).toContain(`variant_id=${VARIANT}`);
    expect(init?.headers).toMatchObject({ authorization: `Bearer ${SECRET}` });
    expect(url).not.toContain('organization_id');
    expect(url).not.toContain('shop_id');
    expect(overlay?.width).toBe(400);
    expect(overlay?.anchor).toEqual({ x: 0.5, y: 0.25 });
  });

  it('returns null when the mirror has no overlay asset', async () => {
    const overlay = await fetchGarmentOverlay(
      SECRET,
      GARMENT,
      VARIANT,
      async () => new Response(JSON.stringify({ error: 'INVALID_REQUEST' }), { status: 400 }),
    );
    expect(overlay).toBeNull();
  });

  it('does not invent an overlay from a malformed body', async () => {
    const spy = vi.fn(
      async () => new Response(JSON.stringify({ overlay_url: 'nope' }), { status: 200 }),
    );
    const overlay = await fetchGarmentOverlay(
      SECRET,
      GARMENT,
      VARIANT,
      spy as unknown as typeof fetch,
    );
    expect(overlay).toBeNull();
  });

  it('returns null for empty credentials or ids without throwing', async () => {
    const spy = vi.fn();
    await expect(
      fetchGarmentOverlay('', GARMENT, VARIANT, spy as unknown as typeof fetch),
    ).resolves.toBeNull();
    await expect(
      fetchGarmentOverlay(SECRET, '', VARIANT, spy as unknown as typeof fetch),
    ).resolves.toBeNull();
    await expect(
      fetchGarmentOverlay(SECRET, GARMENT, '', spy as unknown as typeof fetch),
    ).resolves.toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns null when the response body is not JSON', async () => {
    const overlay = await fetchGarmentOverlay(
      SECRET,
      GARMENT,
      VARIANT,
      async () => new Response('not-json', { status: 200 }),
    );
    expect(overlay).toBeNull();
  });

  it('returns null on network failure instead of throwing', async () => {
    const overlay = await fetchGarmentOverlay(SECRET, GARMENT, VARIANT, async () => {
      throw new Error('offline');
    });
    expect(overlay).toBeNull();
  });
});
