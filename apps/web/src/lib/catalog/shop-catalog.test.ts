import { describe, expect, it } from 'vitest';

import { belongsToShop, filterCatalogForShop, isTestFixtureCatalogName } from './shop-catalog';

const ORG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SHOP_A = '11111111-1111-4111-8111-111111111111';
const SHOP_B = '22222222-2222-4222-8222-222222222222';
const GARMENT_A = '33333333-3333-4333-8333-333333333333';
const GARMENT_B = '44444444-4444-4444-8444-444444444444';
const VARIANT_A = '55555555-5555-4555-8555-555555555555';
const VARIANT_B = '66666666-6666-4666-8666-666666666666';

function garment(id: string, org: string, shop: string, name: string) {
  return {
    id,
    organization_id: org,
    shop_id: shop,
    name,
    category: 'Tops',
    brand: 'Test',
    price_minor: 1000,
    currency_code: 'USD',
    is_active: true,
  };
}

describe('catalog tenant isolation', () => {
  it('keeps only the calling shop\'s active garments', () => {
    const items = filterCatalogForShop(
      [
        garment(GARMENT_A, ORG_A, SHOP_A, 'Shop A tee'),
        garment(GARMENT_B, ORG_B, SHOP_B, 'Other org coat'),
      ],
      [
        {
          id: VARIANT_A,
          garment_id: GARMENT_A,
          organization_id: ORG_A,
          shop_id: SHOP_A,
          color_name: 'Black',
          is_active: true,
        },
        {
          id: VARIANT_B,
          garment_id: GARMENT_B,
          organization_id: ORG_B,
          shop_id: SHOP_B,
          color_name: 'Red',
          is_active: true,
        },
      ],
      { organizationId: ORG_A, shopId: SHOP_A },
    );

    expect(items).toHaveLength(1);
    expect(items[0]?.name).toBe('Shop A tee');
    expect(items[0]?.is_test_fixture).toBe(false);
    expect(items[0]?.has_thumbnail).toBe(false);
    expect(items[0]?.has_overlay).toBe(false);
    expect(items[0]?.fitting_available).toBe(true);
    expect(items[0]?.brand).toBe('Test');
    expect(items[0]?.sizes).toEqual([]);
    expect(JSON.stringify(items)).not.toContain(ORG_B);
    expect(JSON.stringify(items[0])).not.toContain('organization_id');
    expect(JSON.stringify(items[0])).not.toContain('shop_id');
    expect(JSON.stringify(items[0])).not.toContain('storage_path');
  });

  it('marks TEST FIXTURE names and joins shop-scoped sizes only', () => {
    const items = filterCatalogForShop(
      [
        {
          ...garment(GARMENT_A, ORG_A, SHOP_A, 'TEST FIXTURE TOP'),
          category: 'Tops',
        },
      ],
      [
        {
          id: VARIANT_A,
          garment_id: GARMENT_A,
          organization_id: ORG_A,
          shop_id: SHOP_A,
          color_name: 'Fixture Blue',
          is_active: true,
        },
      ],
      { organizationId: ORG_A, shopId: SHOP_A },
      {
        sizesByGarmentId: { [GARMENT_A]: ['S', 'M', 'L'], [GARMENT_B]: ['XL'] },
        thumbnailGarmentIds: new Set([GARMENT_B]),
      },
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.is_test_fixture).toBe(true);
    expect(items[0]?.sizes).toEqual(['S', 'M', 'L']);
    expect(items[0]?.has_thumbnail).toBe(true);
    expect(items[0]?.has_overlay).toBe(true);
    expect(items[0]?.fitting_available).toBe(true);
    expect(items[0]?.audience).toBeNull();
  });

  it('marks commercial garments with OVERLAY presence without exposing storage paths', () => {
    const items = filterCatalogForShop(
      [garment(GARMENT_A, ORG_A, SHOP_A, 'Shop tee')],
      [
        {
          id: VARIANT_A,
          garment_id: GARMENT_A,
          organization_id: ORG_A,
          shop_id: SHOP_A,
          color_name: 'Black',
          is_active: true,
        },
      ],
      { organizationId: ORG_A, shopId: SHOP_A },
      { overlayGarmentIds: new Set([GARMENT_A]) },
    );
    expect(items[0]?.has_overlay).toBe(true);
    expect(JSON.stringify(items[0])).not.toContain('storage_path');
    expect(JSON.stringify(items[0])).not.toContain('overlay_url');
  });

  it('marks lower-body categories as fitting-available', () => {
    const items = filterCatalogForShop(
      [{ ...garment(GARMENT_A, ORG_A, SHOP_A, 'Shop jeans'), category: 'Jeans' }],
      [
        {
          id: VARIANT_A,
          garment_id: GARMENT_A,
          organization_id: ORG_A,
          shop_id: SHOP_A,
          color_name: 'Blue',
          is_active: true,
        },
      ],
      { organizationId: ORG_A, shopId: SHOP_A },
    );
    expect(items[0]?.fitting_available).toBe(true);
  });

  it('rejects a row that claims another organization', () => {
    expect(
      belongsToShop(
        { organization_id: ORG_B, shop_id: SHOP_A },
        { organizationId: ORG_A, shopId: SHOP_A },
      ),
    ).toBe(false);
  });

  it('does not project an inactive garment or variant', () => {
    const items = filterCatalogForShop(
      [{ ...garment(GARMENT_A, ORG_A, SHOP_A, 'Hidden'), is_active: false }],
      [
        {
          id: VARIANT_A,
          garment_id: GARMENT_A,
          organization_id: ORG_A,
          shop_id: SHOP_A,
          color_name: 'Black',
          is_active: true,
        },
      ],
      { organizationId: ORG_A, shopId: SHOP_A },
    );
    expect(items).toEqual([]);
  });

  it('does not treat a commercial name as a test fixture', () => {
    expect(isTestFixtureCatalogName('Shop A tee')).toBe(false);
    expect(isTestFixtureCatalogName('TEST FIXTURE TOP')).toBe(true);
    expect(isTestFixtureCatalogName('TEST FIXTURE PANTS')).toBe(true);
  });

  it('marks TEST FIXTURE PANTS as a selectable LOWER_BODY fixture with overlay availability', () => {
    const items = filterCatalogForShop(
      [
        {
          ...garment(GARMENT_A, ORG_A, SHOP_A, 'TEST FIXTURE PANTS'),
          category: 'Pants',
          brand: 'TEST FIXTURE',
        },
      ],
      [
        {
          id: VARIANT_A,
          garment_id: GARMENT_A,
          organization_id: ORG_A,
          shop_id: SHOP_A,
          color_name: 'Fixture Navy',
          is_active: true,
        },
      ],
      { organizationId: ORG_A, shopId: SHOP_A },
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.is_test_fixture).toBe(true);
    expect(items[0]?.has_overlay).toBe(true);
    expect(items[0]?.has_thumbnail).toBe(true);
    expect(items[0]?.fitting_available).toBe(true);
    expect(items[0]?.category).toBe('Pants');
  });

  it('never projects organization or storage fields onto the phone', () => {
    const items = filterCatalogForShop(
      [garment(GARMENT_A, ORG_A, SHOP_A, 'Shop A tee')],
      [
        {
          id: VARIANT_A,
          garment_id: GARMENT_A,
          organization_id: ORG_A,
          shop_id: SHOP_A,
          color_name: 'Black',
          is_active: true,
        },
      ],
      { organizationId: ORG_A, shopId: SHOP_A },
      { thumbnailGarmentIds: new Set([GARMENT_A]) },
    );
    const json = JSON.stringify(items);
    expect(json).not.toMatch(/organization_id|shop_id|storage_path|storage_bucket|content_hash/);
    expect(items[0]?.has_thumbnail).toBe(true);
  });

  it('publishes every active color variant for a shop garment', () => {
    const items = filterCatalogForShop(
      [garment(GARMENT_A, ORG_A, SHOP_A, 'Shop tee')],
      [
        {
          id: VARIANT_A,
          garment_id: GARMENT_A,
          organization_id: ORG_A,
          shop_id: SHOP_A,
          color_name: 'Black',
          is_active: true,
        },
        {
          id: VARIANT_B,
          garment_id: GARMENT_A,
          organization_id: ORG_A,
          shop_id: SHOP_A,
          color_name: 'Red',
          is_active: true,
        },
      ],
      { organizationId: ORG_A, shopId: SHOP_A },
    );
    expect(items).toHaveLength(2);
    expect(items.map((row) => row?.color_name)).toEqual(['Black', 'Red']);
  });
});
