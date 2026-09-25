export interface CustomerCatalogItem {
  readonly garmentId: string;
  readonly variantId: string;
  readonly name: string;
  readonly category: string;
  readonly brand: string | null;
  readonly colorName: string;
  readonly isTestFixture: boolean;
  readonly sizes: readonly string[];
  readonly hasThumbnail: boolean;
  readonly fittingAvailable: boolean;
}

export async function listSessionCatalog(
  token: string,
  fetchFn: typeof fetch = fetch,
): Promise<CustomerCatalogItem[] | null> {
  let response: Response;
  try {
    response = await fetchFn('/api/session/catalog', {
      headers: { authorization: `Bearer ${token}` },
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || !Array.isArray(body['garments'])) return [];
  const items: CustomerCatalogItem[] = [];
  for (const row of body['garments']) {
    if (!row || typeof row !== 'object') continue;
    const record = row as Record<string, unknown>;
    if (
      typeof record['garment_id'] !== 'string' ||
      typeof record['variant_id'] !== 'string' ||
      typeof record['name'] !== 'string' ||
      typeof record['category'] !== 'string' ||
      typeof record['color_name'] !== 'string'
    ) {
      continue;
    }
    items.push({
      garmentId: record['garment_id'],
      variantId: record['variant_id'],
      name: record['name'],
      category: record['category'],
      brand: typeof record['brand'] === 'string' ? record['brand'] : null,
      colorName: record['color_name'],
      isTestFixture: record['is_test_fixture'] === true,
      hasThumbnail: record['has_thumbnail'] === true,
      fittingAvailable: record['fitting_available'] === true,
      sizes: Array.isArray(record['sizes'])
        ? record['sizes'].filter((value): value is string => typeof value === 'string')
        : [],
    });
  }
  return items;
}

export async function selectSessionGarment(
  token: string,
  garment: { garmentId: string; variantId: string; category?: string } | null,
  fetchFn: typeof fetch = fetch,
): Promise<boolean> {
  let response: Response;
  try {
    response = await fetchFn('/api/session/garment', {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(
        garment
          ? {
            garment_id: garment.garmentId,
            variant_id: garment.variantId,
            category: garment.category,
          }
          : { garment_id: null, variant_id: null },
      ),
    });
  } catch {
    return false;
  }
  return response.ok;
}
