import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  GARMENT_ASSETS_ALLOWED_MIME_TYPES,
  GARMENT_ASSETS_BUCKET,
  GARMENT_ASSETS_MAX_BYTES,
  garmentAssetObjectPath,
  isTenantScopedGarmentAssetPath,
} from './garment-asset-storage';

const ORG = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const SHOP = '11111111-2222-4333-8444-555555555555';

describe('garment asset storage path convention', () => {
  it('exports the private bucket name expected by the schema default', () => {
    expect(GARMENT_ASSETS_BUCKET).toBe('garment-assets');
  });

  it('builds org/shop-prefixed object keys', () => {
    expect(garmentAssetObjectPath(ORG, SHOP, 'overlays', 'v1.png')).toBe(
      `${ORG}/${SHOP}/overlays/v1.png`,
    );
    expect(isTenantScopedGarmentAssetPath(`${ORG}/${SHOP}/overlays/v1.png`)).toBe(true);
  });

  it('rejects path traversal and non-uuid tenancy', () => {
    expect(() => garmentAssetObjectPath('not-a-uuid', SHOP, 'a.png')).toThrow();
    expect(() => garmentAssetObjectPath(ORG, SHOP, '..', 'a.png')).toThrow();
    expect(() => garmentAssetObjectPath(ORG, SHOP, 'a/b.png')).toThrow();
    expect(isTenantScopedGarmentAssetPath('fixtures/TEST-FIXTURE-TOP.json')).toBe(false);
  });

  it('documents overlay-compatible MIME types and a 32 MiB ceiling', () => {
    expect(GARMENT_ASSETS_ALLOWED_MIME_TYPES).toEqual(['image/png', 'image/webp', 'image/jpeg']);
    expect(GARMENT_ASSETS_MAX_BYTES).toBe(32 * 1024 * 1024);
  });
});

describe('garment-assets storage migration contract', () => {
  const migration = readFileSync(
    resolve(
      import.meta.dirname,
      '../../../../../supabase/migrations/20260926083000_garment_assets_storage_bucket.sql',
    ),
    'utf8',
  );

  it('creates a private garment-assets bucket with mime and size limits', () => {
    expect(migration).toContain("'garment-assets'");
    expect(migration).toMatch(/false,\s*\n\s*33554432/);
    expect(migration).toContain('33554432');
    expect(migration).toContain('image/png');
    expect(migration).toContain('image/webp');
    expect(migration).toContain('image/jpeg');
    expect(migration).toMatch(/public\s*=\s*excluded\.public/);
  });

  it('denies anon and authenticated object access for the bucket', () => {
    expect(migration).toContain('garment_assets_anon_select_deny');
    expect(migration).toContain('garment_assets_authenticated_select_deny');
    expect(migration).toContain('garment_assets_authenticated_insert_deny');
    expect(migration).toContain('garment_assets_authenticated_update_deny');
    expect(migration).toContain('garment_assets_authenticated_delete_deny');
    expect(migration).toMatch(/bucket_id = 'garment-assets' and false/);
    expect(migration).not.toMatch(/to authenticated[\s\S]*using \(true\)/);
    expect(migration).not.toMatch(/public\s*=\s*true/);
  });

  it('documents service-role signed URLs and the org/shop path convention', () => {
    expect(migration).toMatch(/service.role|service_role/i);
    expect(migration).toContain('{organization_id}/{shop_id}/');
    expect(migration).toContain('fixtures/');
  });
});
