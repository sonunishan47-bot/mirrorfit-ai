/**
 * Object-key helpers for the private `garment-assets` Storage bucket.
 *
 * Production overlay bytes are loaded only via service-role signed URLs after
 * device authentication. These helpers do not talk to Storage; they document
 * the preferred path layout for future uploads:
 *
 *   {organization_id}/{shop_id}/...
 *
 * Legacy fixture metadata may still point at paths like `fixtures/<sku>.json`
 * in `garment_assets.storage_path` without existing as Storage objects.
 */

export const GARMENT_ASSETS_BUCKET = 'garment-assets' as const;

/** 32 MiB — matches the Storage bucket file_size_limit migration. */
export const GARMENT_ASSETS_MAX_BYTES = 32 * 1024 * 1024;

export const GARMENT_ASSETS_ALLOWED_MIME_TYPES = [
  'image/png',
  'image/webp',
  'image/jpeg',
] as const;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Builds a tenant-scoped object key. Does not upload.
 * Rejects empty segments and path traversal.
 */
export function garmentAssetObjectPath(
  organizationId: string,
  shopId: string,
  ...rest: readonly string[]
): string {
  if (!UUID.test(organizationId) || !UUID.test(shopId)) {
    throw new Error('organizationId and shopId must be UUIDs');
  }
  if (rest.length === 0) {
    throw new Error('object path requires at least one leaf segment');
  }
  for (const segment of rest) {
    if (
      typeof segment !== 'string' ||
      segment.length === 0 ||
      segment.includes('/') ||
      segment.includes('\\') ||
      segment === '.' ||
      segment === '..'
    ) {
      throw new Error('invalid object path segment');
    }
  }
  return [organizationId, shopId, ...rest].join('/');
}

/** True when a path follows the org/shop prefix convention (not fixtures/). */
export function isTenantScopedGarmentAssetPath(path: string): boolean {
  const parts = path.split('/').filter((part) => part.length > 0);
  if (parts.length < 3) return false;
  return UUID.test(parts[0]!) && UUID.test(parts[1]!);
}
