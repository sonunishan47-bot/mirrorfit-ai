import { resolveFitCategory } from '@mirrorfit/tryon-core';
import { catalogGarmentRowSchema, customerCatalogItemSchema } from '@mirrorfit/validation';

export interface TenantScope {
  readonly organizationId: string;
  readonly shopId: string;
}

export interface CatalogVariantRow {
  readonly id: string;
  readonly garment_id: string;
  readonly organization_id: string;
  readonly shop_id: string;
  readonly color_name: string;
  readonly is_active: boolean;
}

export interface CatalogExtras {
  readonly sizesByGarmentId?: Readonly<Record<string, readonly string[]>>;
  readonly thumbnailGarmentIds?: ReadonlySet<string>;
  /** Garment ids with a drawable OVERLAY asset (presence only — no storage paths). */
  readonly overlayGarmentIds?: ReadonlySet<string>;
}

/**
 * Keeps a catalog row only when it belongs to the already-resolved tenant.
 *
 * Callers pass organization and shop from the pairing token or device
 * credential. A client-supplied org id is never an argument here.
 */
export function belongsToShop<T extends { organization_id: string; shop_id: string }>(
  row: T,
  scope: TenantScope,
): boolean {
  return row.organization_id === scope.organizationId && row.shop_id === scope.shopId;
}

export function isTestFixtureCatalogName(name: string): boolean {
  return name.startsWith('TEST FIXTURE');
}

export function projectCustomerCatalogItem(
  garment: unknown,
  variant: unknown,
  extras: CatalogExtras = {},
): ReturnType<typeof customerCatalogItemSchema.parse> | null {
  const parsedGarment = catalogGarmentRowSchema.safeParse(garment);
  const parsedVariant =
    variant && typeof variant === 'object'
      ? (variant as CatalogVariantRow)
      : null;
  if (!parsedGarment.success || !parsedVariant) return null;
  if (!parsedGarment.data.is_active || !parsedVariant.is_active) return null;

  const item = {
    garment_id: parsedGarment.data.id,
    variant_id: parsedVariant.id,
    name: parsedGarment.data.name,
    category: parsedGarment.data.category,
    brand: parsedGarment.data.brand,
    color_name: parsedVariant.color_name,
    price_minor: parsedGarment.data.price_minor,
    currency_code: parsedGarment.data.currency_code,
    audience: null,
    sizes: [...(extras.sizesByGarmentId?.[parsedGarment.data.id] ?? [])],
    is_test_fixture: isTestFixtureCatalogName(parsedGarment.data.name),
    has_thumbnail:
      isTestFixtureCatalogName(parsedGarment.data.name) ||
      extras.thumbnailGarmentIds?.has(parsedGarment.data.id) === true,
    has_overlay:
      isTestFixtureCatalogName(parsedGarment.data.name) ||
      extras.overlayGarmentIds?.has(parsedGarment.data.id) === true,
    fitting_available: resolveFitCategory(parsedGarment.data.category) !== null,
  };
  const published = customerCatalogItemSchema.safeParse(item);
  return published.success ? published.data : null;
}

/**
 * Publishes one customer-facing row per active shop-scoped color variant.
 * Inactive variants and other-tenant rows are dropped — never invented.
 */
export function filterCatalogForShop(
  garments: readonly unknown[],
  variants: readonly CatalogVariantRow[],
  scope: TenantScope,
  extras: CatalogExtras = {},
): ReturnType<typeof projectCustomerCatalogItem>[] {
  const items: ReturnType<typeof projectCustomerCatalogItem>[] = [];
  for (const garment of garments) {
    const parsed = catalogGarmentRowSchema.safeParse(garment);
    if (!parsed.success || !belongsToShop(parsed.data, scope)) continue;
    const shopVariants = variants.filter(
      (row) => row.garment_id === parsed.data.id && belongsToShop(row, scope) && row.is_active,
    );
    for (const variant of shopVariants) {
      const item = projectCustomerCatalogItem(parsed.data, variant, extras);
      if (item) items.push(item);
    }
  }
  return items;
}
