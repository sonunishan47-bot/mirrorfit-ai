import 'server-only';

import { createSupabaseAdminClient } from '@/lib/supabase/admin-client';

import {
  filterCatalogForShop,
  type CatalogExtras,
  type TenantScope,
} from './shop-catalog';

/**
 * Active catalog for one already-resolved shop.
 *
 * Size labels come from size_charts / size_measurements owned by that shop.
 * Thumbnails are reported as presence only — storage paths stay off the phone.
 * Audience stays null: garments have no gender column.
 */
export async function loadShopCatalog(scope: TenantScope) {
  const supabase = createSupabaseAdminClient();
  const [garments, variants, charts, measurements, thumbnails] = await Promise.all([
    supabase
      .from('garments')
      .select('id, organization_id, shop_id, name, category, brand, price_minor, currency_code, is_active')
      .eq('organization_id', scope.organizationId)
      .eq('shop_id', scope.shopId)
      .eq('is_active', true),
    supabase
      .from('garment_variants')
      .select('id, garment_id, organization_id, shop_id, color_name, is_active')
      .eq('organization_id', scope.organizationId)
      .eq('shop_id', scope.shopId)
      .eq('is_active', true),
    supabase
      .from('size_charts')
      .select('id, garment_id, organization_id, shop_id')
      .eq('organization_id', scope.organizationId)
      .eq('shop_id', scope.shopId)
      .not('garment_id', 'is', null),
    supabase
      .from('size_measurements')
      .select('size_chart_id, size_label, organization_id, shop_id')
      .eq('organization_id', scope.organizationId)
      .eq('shop_id', scope.shopId),
    supabase
      .from('garment_assets')
      .select('garment_id, organization_id, kind')
      .eq('organization_id', scope.organizationId)
      .eq('kind', 'THUMBNAIL'),
  ]);

  if (garments.error || variants.error || charts.error || measurements.error || thumbnails.error) {
    return null;
  }

  const shopGarmentIds = new Set(
    (garments.data ?? []).map((row) => row.id).filter((id): id is string => typeof id === 'string'),
  );
  const extras = extrasForShop(
    scope,
    charts.data ?? [],
    measurements.data ?? [],
    thumbnails.data ?? [],
    shopGarmentIds,
  );
  return filterCatalogForShop(garments.data ?? [], variants.data ?? [], scope, extras);
}

function extrasForShop(
  scope: TenantScope,
  charts: readonly {
    id: string;
    garment_id: string | null;
    organization_id: string;
    shop_id: string;
  }[],
  measurements: readonly {
    size_chart_id: string;
    size_label: string;
    organization_id: string;
    shop_id: string;
  }[],
  thumbnails: readonly { garment_id: string; organization_id: string; kind: string }[],
  shopGarmentIds: ReadonlySet<string>,
): CatalogExtras {
  const chartById = new Map<string, string>();
  for (const chart of charts) {
    if (!chart.garment_id) continue;
    if (chart.organization_id !== scope.organizationId || chart.shop_id !== scope.shopId) continue;
    chartById.set(chart.id, chart.garment_id);
  }

  const sizesByGarmentId: Record<string, string[]> = {};
  for (const row of measurements) {
    if (row.organization_id !== scope.organizationId || row.shop_id !== scope.shopId) continue;
    const garmentId = chartById.get(row.size_chart_id);
    if (!garmentId) continue;
    const list = sizesByGarmentId[garmentId] ?? [];
    if (!list.includes(row.size_label)) list.push(row.size_label);
    sizesByGarmentId[garmentId] = list;
  }

  const thumbnailGarmentIds = new Set<string>();
  for (const row of thumbnails) {
    if (row.organization_id !== scope.organizationId) continue;
    if (!shopGarmentIds.has(row.garment_id)) continue;
    thumbnailGarmentIds.add(row.garment_id);
  }

  return { sizesByGarmentId, thumbnailGarmentIds };
}
