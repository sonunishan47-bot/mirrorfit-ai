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
 * TOP and LOWER_BODY are the live 2D overlay families.
 * FULL_BODY is photorealistic-only: the 2D engine must not warp it.
 */
export const GARMENT_FIT_CATEGORIES = ['TOP', 'LOWER_BODY', 'FULL_BODY'] as const;
export type GarmentFitCategory = (typeof GARMENT_FIT_CATEGORIES)[number];
