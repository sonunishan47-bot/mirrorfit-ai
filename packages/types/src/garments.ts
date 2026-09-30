/**
 * Catalog vocabulary that is not a database enum.
 *
 * Shop tenancy lives on the garment row (`organization_id`, `shop_id`).
 * Audience is optional metadata, not a Postgres enum, so adding a value
 * here does not require a migration.
 */

export const GARMENT_AUDIENCES = ['WOMENS', 'MENS', 'UNISEX'] as const;
export type GarmentAudience = (typeof GARMENT_AUDIENCES)[number];

/**
 * Fitting families.
 *
 * TOP uses the shirt parallelogram. LOWER_BODY uses the pants parallelogram.
 * FULL_BODY uses its own shoulder-to-hem silhouette. Do not send it through
 * the shirt warp. A photograph still requires the GPU worker.
 */
export const GARMENT_FIT_CATEGORIES = ['TOP', 'LOWER_BODY', 'FULL_BODY'] as const;
export type GarmentFitCategory = (typeof GARMENT_FIT_CATEGORIES)[number];
