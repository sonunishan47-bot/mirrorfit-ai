import { resolveFitCategory } from '@mirrorfit/tryon-core';

import type { CustomerCatalogItem } from './catalog-client';

export type CatalogBrowseFilter = 'all' | 'tops' | 'bottoms' | 'outfits';

export const CATALOG_BROWSE_FILTERS: ReadonlyArray<{
  readonly id: CatalogBrowseFilter;
  readonly label: string;
}> = [
  { id: 'all', label: 'All' },
  { id: 'tops', label: 'Tops' },
  { id: 'bottoms', label: 'Bottoms' },
  { id: 'outfits', label: 'Outfits' },
];

const OUTFIT =
  /^(outfits?|sets?|looks?|full[-\s]?outfits?|co-?ords?|ensembles?)$/i;

/**
 * Browse family for phone filters. Fitting families stay TOP / LOWER_BODY;
 * outfits are browse-only when the shop category uses those names.
 */
export function catalogBrowseFamily(
  category: string,
): 'tops' | 'bottoms' | 'outfits' | 'other' {
  const fit = resolveFitCategory(category);
  if (fit === 'TOP') return 'tops';
  if (fit === 'LOWER_BODY') return 'bottoms';
  if (OUTFIT.test(category.trim())) return 'outfits';
  return 'other';
}

export function filterCatalogItems(
  items: readonly CustomerCatalogItem[],
  filter: CatalogBrowseFilter,
): CustomerCatalogItem[] {
  if (filter === 'all') return [...items];
  return items.filter((item) => catalogBrowseFamily(item.category) === filter);
}

export interface CatalogGarmentGroup {
  readonly garmentId: string;
  readonly name: string;
  readonly category: string;
  readonly brand: string | null;
  readonly sizes: readonly string[];
  readonly isTestFixture: boolean;
  readonly hasThumbnail: boolean;
  readonly hasOverlay: boolean;
  readonly fittingAvailable: boolean;
  readonly priceMinor: number | null;
  readonly currencyCode: string | null;
  readonly variants: readonly CustomerCatalogItem[];
}

/**
 * Groups flat catalog rows (one per color variant) into garment cards.
 * Order follows first appearance in the shop catalog.
 */
export function groupCatalogByGarment(
  items: readonly CustomerCatalogItem[],
): CatalogGarmentGroup[] {
  const order: string[] = [];
  const map = new Map<string, CustomerCatalogItem[]>();
  for (const item of items) {
    const list = map.get(item.garmentId);
    if (!list) {
      order.push(item.garmentId);
      map.set(item.garmentId, [item]);
    } else {
      list.push(item);
    }
  }
  return order.map((garmentId) => {
    const variants = map.get(garmentId)!;
    const head = variants[0]!;
    return {
      garmentId,
      name: head.name,
      category: head.category,
      brand: head.brand,
      sizes: head.sizes,
      isTestFixture: head.isTestFixture,
      hasThumbnail: head.hasThumbnail,
      hasOverlay: variants.some((v) => v.hasOverlay),
      fittingAvailable: head.fittingAvailable,
      priceMinor: head.priceMinor,
      currencyCode: head.currencyCode,
      variants,
    };
  });
}

export function formatCatalogPrice(
  priceMinor: number | null,
  currencyCode: string | null,
): string | null {
  if (priceMinor === null || !currencyCode) return null;
  if (!Number.isFinite(priceMinor) || priceMinor < 0) return null;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currencyCode,
    }).format(priceMinor / 100);
  } catch {
    return `${(priceMinor / 100).toFixed(2)} ${currencyCode}`;
  }
}

export function fittingAvailabilityLabel(item: {
  readonly fittingAvailable: boolean;
  readonly hasOverlay: boolean;
  readonly isTestFixture: boolean;
}): string {
  if (!item.fittingAvailable) return 'Browse only · not fitted on mirror';
  if (item.hasOverlay || item.isTestFixture) return 'Ready to try on the mirror';
  return 'Fitting available · overlay asset pending';
}

/**
 * Latest-only guard so rapid color/size taps cannot apply an older
 * /api/session/garment response after a newer selection.
 */
export class CatalogSelectionGuard {
  #generation = 0;

  begin(): number {
    this.#generation += 1;
    return this.#generation;
  }

  isCurrent(token: number): boolean {
    return token === this.#generation;
  }

  invalidate(): void {
    this.#generation += 1;
  }
}
