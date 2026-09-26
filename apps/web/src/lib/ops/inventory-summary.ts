/**
 * Inventory distribution summaries for staff ops.
 * Presence flags only — never storage paths or signed URLs.
 */

export interface InventoryGarmentRow {
  readonly id: string;
  readonly shop_id: string;
  readonly category: string;
  readonly is_active: boolean;
}

export interface InventoryVariantRow {
  readonly id: string;
  readonly garment_id: string;
  readonly shop_id: string;
  readonly is_active: boolean;
}

export interface InventoryOverlayPresence {
  readonly garment_id: string;
}

export interface CategoryInventory {
  category: string;
  garments: number;
  variants: number;
  with_overlay: number;
}

export interface InventoryDistribution {
  readonly active_garments: number;
  readonly active_variants: number;
  readonly garments_with_overlay: number;
  readonly by_category: readonly CategoryInventory[];
}

export function summarizeInventoryDistribution(
  garments: readonly InventoryGarmentRow[],
  variants: readonly InventoryVariantRow[],
  overlays: readonly InventoryOverlayPresence[],
  shopId: string,
): InventoryDistribution {
  const shopGarments = garments.filter((g) => g.shop_id === shopId && g.is_active);
  const shopVariants = variants.filter((v) => v.shop_id === shopId && v.is_active);
  const overlayIds = new Set(
    overlays.map((row) => row.garment_id).filter((id) => shopGarments.some((g) => g.id === id)),
  );

  const byCategory = new Map<string, CategoryInventory>();
  for (const garment of shopGarments) {
    const current = byCategory.get(garment.category) ?? {
      category: garment.category,
      garments: 0,
      variants: 0,
      with_overlay: 0,
    };
    current.garments += 1;
    if (overlayIds.has(garment.id)) current.with_overlay += 1;
    byCategory.set(garment.category, current);
  }
  for (const variant of shopVariants) {
    const garment = shopGarments.find((g) => g.id === variant.garment_id);
    if (!garment) continue;
    const current = byCategory.get(garment.category);
    if (!current) continue;
    current.variants += 1;
  }

  const by_category = [...byCategory.values()].sort(
    (a, b) => b.garments - a.garments || a.category.localeCompare(b.category),
  );

  return {
    active_garments: shopGarments.length,
    active_variants: shopVariants.length,
    garments_with_overlay: overlayIds.size,
    by_category,
  };
}
