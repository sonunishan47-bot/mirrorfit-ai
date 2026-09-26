import { describe, expect, it } from 'vitest';

import { listSessionCatalog, selectSessionGarment } from './catalog-client';

const TOKEN = 'p'.repeat(43);

describe('customer catalog client', () => {
  it('maps a shop catalog and does not invent rows', async () => {
    const items = await listSessionCatalog(TOKEN, () => {
      return Promise.resolve(new Response(
        JSON.stringify({
          garments: [
            {
              garment_id: '33333333-3333-4333-8333-333333333333',
              variant_id: '55555555-5555-4555-8555-555555555555',
              name: 'Shop tee',
              category: 'Tops',
              color_name: 'Black',
              is_test_fixture: false,
              has_thumbnail: false,
              sizes: ['M'],
            },
          ],
        }),
        { status: 200 },
      ));
    });
    expect(items).toEqual([
      {
        garmentId: '33333333-3333-4333-8333-333333333333',
        variantId: '55555555-5555-4555-8555-555555555555',
        name: 'Shop tee',
        category: 'Tops',
        brand: null,
        colorName: 'Black',
        isTestFixture: false,
        hasThumbnail: false,
        hasOverlay: false,
        fittingAvailable: false,
        priceMinor: null,
        currencyCode: null,
        sizes: ['M'],
      },
    ]);
  });

  it('maps brand, fitting_available, and has_overlay when the API provides them', async () => {
    const items = await listSessionCatalog(TOKEN, () => {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            garments: [
              {
                garment_id: '33333333-3333-4333-8333-333333333333',
                variant_id: '55555555-5555-4555-8555-555555555555',
                name: 'TEST FIXTURE TOP',
                category: 'Tops',
                brand: 'MirrorFit Lab',
                color_name: 'Fixture Blue',
                is_test_fixture: true,
                has_thumbnail: false,
                has_overlay: true,
                fitting_available: true,
                price_minor: 0,
                currency_code: 'USD',
                sizes: ['S', 'M'],
              },
            ],
          }),
          { status: 200 },
        ),
      );
    });
    expect(items?.[0]?.brand).toBe('MirrorFit Lab');
    expect(items?.[0]?.fittingAvailable).toBe(true);
    expect(items?.[0]?.hasOverlay).toBe(true);
    expect(items?.[0]?.isTestFixture).toBe(true);
    expect(items?.[0]?.priceMinor).toBe(0);
    expect(items?.[0]?.currencyCode).toBe('USD');
  });

  it('returns an empty list when the shop has no garments', async () => {
    const items = await listSessionCatalog(
      TOKEN,
      () => Promise.resolve(new Response(JSON.stringify({ garments: [] }), { status: 200 })),
    );
    expect(items).toEqual([]);
  });

  it('sends a clear payload without a device secret', async () => {
    let body = '';
    const ok = await selectSessionGarment(TOKEN, null, (_url, init) => {
      body = typeof init?.body === 'string' ? init.body : '';
      return Promise.resolve(new Response(JSON.stringify({ selected: null }), { status: 200 }));
    });
    expect(ok).toBe(true);
    expect(body).toBe('{"garment_id":null,"variant_id":null}');
    expect(body).not.toContain('device_secret');
  });

  it('sends category with a selection and never an organization id', async () => {
    let body = '';
    let headers: HeadersInit | undefined;
    const ok = await selectSessionGarment(
      TOKEN,
      {
        garmentId: '33333333-3333-4333-8333-333333333333',
        variantId: '55555555-5555-4555-8555-555555555555',
        category: 'Tops',
      },
      (_url, init) => {
        body = typeof init?.body === 'string' ? init.body : '';
        headers = init?.headers;
        return Promise.resolve(new Response(JSON.stringify({ selected: {} }), { status: 200 }));
      },
    );
    expect(ok).toBe(true);
    expect(JSON.parse(body)).toEqual({
      garment_id: '33333333-3333-4333-8333-333333333333',
      variant_id: '55555555-5555-4555-8555-555555555555',
      category: 'Tops',
    });
    expect(body).not.toContain('organization_id');
    expect(headers).toMatchObject({ authorization: `Bearer ${TOKEN}` });
  });
});
