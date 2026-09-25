import { GARMENT_ASSET_KINDS, type GarmentAssetKind } from '@mirrorfit/types';

/**
 * How a garment file is described to the fitting and render layers.
 *
 * No bytes live here. A missing thumbnail or overlay is null, not a
 * generated placeholder image.
 */
export interface GarmentAssetRef {
  readonly garmentId: string;
  readonly variantId: string | null;
  readonly kind: GarmentAssetKind;
  readonly version: number;
  readonly width: number | null;
  readonly height: number | null;
  readonly aspectRatio: number | null;
  readonly hasAlpha: boolean;
  readonly anchor: { readonly x: number; readonly y: number } | null;
}

export function aspectRatioFromSize(width: number | null, height: number | null): number | null {
  if (width === null || height === null || width <= 0 || height <= 0) return null;
  return width / height;
}

export function parseGarmentAssetRef(input: unknown): GarmentAssetRef | null {
  if (!input || typeof input !== 'object') return null;
  const row = input as Record<string, unknown>;
  if (typeof row['garmentId'] !== 'string' || row['garmentId'].length === 0) return null;
  if (!GARMENT_ASSET_KINDS.includes(row['kind'] as GarmentAssetKind)) return null;
  if (typeof row['version'] !== 'number' || !Number.isInteger(row['version']) || row['version'] < 1) {
    return null;
  }
  const width = typeof row['width'] === 'number' && row['width'] > 0 ? row['width'] : null;
  const height = typeof row['height'] === 'number' && row['height'] > 0 ? row['height'] : null;
  const variantId = typeof row['variantId'] === 'string' ? row['variantId'] : null;
  const anchor =
    row['anchor'] && typeof row['anchor'] === 'object'
      ? parseAnchor(row['anchor'])
      : null;
  if (row['anchor'] && !anchor) return null;

  return {
    garmentId: row['garmentId'],
    variantId,
    kind: row['kind'] as GarmentAssetKind,
    version: row['version'],
    width,
    height,
    aspectRatio: aspectRatioFromSize(width, height),
    hasAlpha: row['hasAlpha'] === true,
    anchor,
  };
}

function parseAnchor(input: unknown): { x: number; y: number } | null {
  if (!input || typeof input !== 'object') return null;
  const row = input as Record<string, unknown>;
  if (typeof row['x'] !== 'number' || typeof row['y'] !== 'number') return null;
  if (row['x'] < 0 || row['x'] > 1 || row['y'] < 0 || row['y'] > 1) return null;
  return { x: row['x'], y: row['y'] };
}

export const OVERLAY_MIME_TYPES = ['image/png', 'image/webp'] as const;

export type GarmentAssetValidation =
  | { readonly ok: true; readonly kind: 'REAL_PRODUCT_ASSET' | 'TEST_FIXTURE_ASSET'; readonly ref: GarmentAssetRef }
  | { readonly ok: false; readonly reason: string };

/**
 * Validates catalog metadata. Does not fetch or invent image bytes.
 * Overlay assets that will be drawn must declare alpha.
 */
export function validateGarmentAssetMetadata(input: unknown): GarmentAssetValidation {
  const ref = parseGarmentAssetRef(input);
  if (!ref) {
    return { ok: false, reason: 'INVALID_ASSET_METADATA' };
  }
  if (ref.kind === 'OVERLAY' || ref.kind === 'ALPHA_MASK') {
    if (!ref.hasAlpha) {
      return { ok: false, reason: 'OVERLAY_REQUIRES_ALPHA' };
    }
    if (ref.width === null || ref.height === null) {
      return { ok: false, reason: 'OVERLAY_REQUIRES_DIMENSIONS' };
    }
  }
  const row = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
  const mime = row['mimeType'];
  if (mime !== undefined) {
    if (typeof mime !== 'string' || !OVERLAY_MIME_TYPES.includes(mime as (typeof OVERLAY_MIME_TYPES)[number])) {
      return { ok: false, reason: 'UNSUPPORTED_MIME_TYPE' };
    }
  }
  return {
    ok: true,
    kind: isTestFixtureAsset(ref) ? 'TEST_FIXTURE_ASSET' : 'REAL_PRODUCT_ASSET',
    ref,
  };
}

export function isTestFixtureAsset(ref: GarmentAssetRef): boolean {
  return ref.garmentId === TEST_FIXTURE_OVERLAY_ASSET.garmentId;
}

/** Test-only fixture. Not a product image and not for the kiosk UI. */
export const TEST_FIXTURE_OVERLAY_ASSET: GarmentAssetRef = {
  garmentId: '00000000-0000-4000-8000-000000000001',
  variantId: '00000000-0000-4000-8000-000000000002',
  kind: 'OVERLAY',
  version: 1,
  width: 400,
  height: 600,
  aspectRatio: 400 / 600,
  hasAlpha: true,
  anchor: { x: 0.5, y: 0.35 },
};
