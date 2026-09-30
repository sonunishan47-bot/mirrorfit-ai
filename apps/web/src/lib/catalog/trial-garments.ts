import { createHash } from 'node:crypto';

/**
 * Two labelled trial garments for a physical camera check.
 * Not commercial products. The mirror draws the in-browser shirt and pants
 * fixtures; nothing is uploaded and no photorealistic image is invented.
 */
export interface TrialFixtureSpec {
  readonly sku: string;
  readonly name: string;
  readonly category: string;
  readonly colorName: string;
  readonly colorHex: string;
  readonly variantSku: string;
  readonly overlay: 'geometric-shirt' | 'geometric-pants';
  readonly chartName: string;
  readonly measurements: readonly {
    readonly size_label: 'S' | 'M' | 'L';
    readonly chest_cm?: number;
    readonly shoulder_cm?: number;
    readonly waist_cm?: number;
    readonly hip_cm?: number;
  }[];
}

export const TRIAL_SHIRT: TrialFixtureSpec = {
  sku: 'TEST-FIXTURE-TOP',
  name: 'TEST FIXTURE Shirt',
  category: 'Tops',
  colorName: 'Navy',
  colorHex: '#1e3a5f',
  variantSku: 'TEST-FIXTURE-TOP-NAVY',
  overlay: 'geometric-shirt',
  chartName: 'TEST FIXTURE Shirt chart',
  measurements: [
    { size_label: 'S', chest_cm: 90, shoulder_cm: 42 },
    { size_label: 'M', chest_cm: 98, shoulder_cm: 45 },
    { size_label: 'L', chest_cm: 106, shoulder_cm: 48 },
  ],
};

export const TRIAL_PANTS: TrialFixtureSpec = {
  sku: 'TEST-FIXTURE-PANTS',
  name: 'TEST FIXTURE Pants',
  category: 'Pants',
  colorName: 'Charcoal',
  colorHex: '#2c333a',
  variantSku: 'TEST-FIXTURE-PANTS-CHARCOAL',
  overlay: 'geometric-pants',
  chartName: 'TEST FIXTURE Pants chart',
  measurements: [
    { size_label: 'S', waist_cm: 76, hip_cm: 92 },
    { size_label: 'M', waist_cm: 84, hip_cm: 100 },
    { size_label: 'L', waist_cm: 92, hip_cm: 108 },
  ],
};

export const TRIAL_FIXTURES: readonly TrialFixtureSpec[] = [TRIAL_SHIRT, TRIAL_PANTS];

const DESCRIPTION =
  'Trial garment for a physical mirror check. Geometric overlay only. Not a commercial product. TEST_FIXTURE_ASSET.';

export interface TrialShop {
  readonly organization_id: string;
  readonly shop_id: string;
  readonly name?: string;
}

interface TrialError {
  readonly message: string;
}

export interface TrialResult<T> {
  readonly data: T;
  readonly error: TrialError | null;
}

export interface TrialQuery extends PromiseLike<TrialResult<unknown>> {
  select(columns: string): TrialQuery;
  eq(column: string, value: string | number): TrialQuery;
  insert(row: Record<string, unknown>): TrialQuery;
  update(row: Record<string, unknown>): TrialQuery;
  maybeSingle(): Promise<TrialResult<Record<string, unknown> | null>>;
  single(): Promise<TrialResult<Record<string, unknown>>>;
}

/** Structural slice of the service-role client. Enough for the trial upsert. */
export interface TrialWriter {
  from(table: string): TrialQuery;
}

function failed(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

function readSkus(data: unknown): Set<string> {
  const present = new Set<string>();
  if (!Array.isArray(data)) return present;
  for (const row of data) {
    if (typeof row !== 'object' || row === null) continue;
    const sku = Object.getOwnPropertyDescriptor(row, 'sku')?.value as unknown;
    if (typeof sku === 'string') present.add(sku);
  }
  return present;
}

async function upsertOne(
  db: TrialWriter,
  shop: TrialShop,
  fixture: TrialFixtureSpec,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const organizationId = shop.organization_id;
  const shopId = shop.shop_id;

  const existing = await db
    .from('garments')
    .select('id')
    .eq('shop_id', shopId)
    .eq('sku', fixture.sku)
    .maybeSingle();
  if (existing.error) return failed(`garments lookup (${fixture.sku}): ${existing.error.message}`);

  let garmentId = typeof existing.data?.['id'] === 'string' ? existing.data['id'] : null;
  if (!garmentId) {
    const inserted = await db
      .from('garments')
      .insert({
        organization_id: organizationId,
        shop_id: shopId,
        sku: fixture.sku,
        name: fixture.name,
        description: DESCRIPTION,
        category: fixture.category,
        brand: 'TEST FIXTURE',
        price_minor: null,
        currency_code: null,
        is_active: true,
      })
      .select('id')
      .single();
    if (inserted.error || typeof inserted.data['id'] !== 'string') {
      return failed(`garments insert (${fixture.sku}): ${inserted.error?.message ?? 'no id'}`);
    }
    garmentId = inserted.data['id'];
  } else {
    const updated = await db
      .from('garments')
      .update({
        name: fixture.name,
        description: DESCRIPTION,
        category: fixture.category,
        brand: 'TEST FIXTURE',
        is_active: true,
      })
      .eq('id', garmentId)
      .eq('shop_id', shopId);
    if (updated.error) return failed(`garments update (${fixture.sku}): ${updated.error.message}`);
  }

  const variant = await db
    .from('garment_variants')
    .select('id')
    .eq('garment_id', garmentId)
    .eq('color_name', fixture.colorName)
    .maybeSingle();
  if (variant.error) return failed(`variants lookup (${fixture.sku}): ${variant.error.message}`);

  let variantId = typeof variant.data?.['id'] === 'string' ? variant.data['id'] : null;
  if (!variantId) {
    const insertedVariant = await db
      .from('garment_variants')
      .insert({
        organization_id: organizationId,
        shop_id: shopId,
        garment_id: garmentId,
        color_name: fixture.colorName,
        color_hex: fixture.colorHex,
        sku: fixture.variantSku,
        is_active: true,
      })
      .select('id')
      .single();
    if (insertedVariant.error || typeof insertedVariant.data['id'] !== 'string') {
      return failed(
        `variants insert (${fixture.sku}): ${insertedVariant.error?.message ?? 'no id'}`,
      );
    }
    variantId = insertedVariant.data['id'];
  }

  const chart = await db.from('size_charts').select('id').eq('garment_id', garmentId).maybeSingle();
  if (chart.error) return failed(`size_charts lookup (${fixture.sku}): ${chart.error.message}`);

  let chartId = typeof chart.data?.['id'] === 'string' ? chart.data['id'] : null;
  if (!chartId) {
    const insertedChart = await db
      .from('size_charts')
      .insert({
        organization_id: organizationId,
        shop_id: shopId,
        garment_id: garmentId,
        name: fixture.chartName,
      })
      .select('id')
      .single();
    if (insertedChart.error || typeof insertedChart.data['id'] !== 'string') {
      return failed(
        `size_charts insert (${fixture.sku}): ${insertedChart.error?.message ?? 'no id'}`,
      );
    }
    chartId = insertedChart.data['id'];
  }

  for (const row of fixture.measurements) {
    const measurement = await db
      .from('size_measurements')
      .select('id')
      .eq('size_chart_id', chartId)
      .eq('size_label', row.size_label)
      .maybeSingle();
    if (measurement.error) {
      return failed(`size_measurements lookup (${fixture.sku}): ${measurement.error.message}`);
    }
    if (measurement.data) continue;
    const insertedMeasurement = await db.from('size_measurements').insert({
      organization_id: organizationId,
      shop_id: shopId,
      size_chart_id: chartId,
      size_label: row.size_label,
      chest_cm: row.chest_cm ?? null,
      shoulder_cm: row.shoulder_cm ?? null,
      waist_cm: row.waist_cm ?? null,
      hip_cm: row.hip_cm ?? null,
    });
    if (insertedMeasurement.error) {
      return failed(
        `size_measurements insert (${fixture.sku}): ${insertedMeasurement.error.message}`,
      );
    }
  }

  const metadata = {
    fixture_kind: 'TEST_FIXTURE_ASSET',
    overlay: fixture.overlay,
    commercial_product: false,
    trial: true,
  };
  const payload = JSON.stringify(metadata);
  const contentHash = createHash('sha256').update(payload).digest('hex');

  const asset = await db
    .from('garment_assets')
    .select('id')
    .eq('garment_id', garmentId)
    .eq('kind', 'FITTING_METADATA')
    .eq('version', 1)
    .maybeSingle();
  if (asset.error) return failed(`garment_assets lookup (${fixture.sku}): ${asset.error.message}`);
  if (!asset.data) {
    const insertedAsset = await db.from('garment_assets').insert({
      organization_id: organizationId,
      garment_id: garmentId,
      variant_id: variantId,
      kind: 'FITTING_METADATA',
      version: 1,
      storage_bucket: 'garment-assets',
      storage_path: `fixtures/${fixture.sku}.json`,
      content_hash: contentHash,
      byte_size: payload.length,
      mime_type: 'application/json',
      metadata,
    });
    if (insertedAsset.error) {
      return failed(`garment_assets insert (${fixture.sku}): ${insertedAsset.error.message}`);
    }
  }

  return { ok: true };
}

/**
 * Inserts the trial shirt and pants into one shop. Idempotent on shop + sku.
 * Does not upload image bytes. A later catalog read does nothing once both SKUs exist.
 */
export async function ensureTrialGarments(
  db: TrialWriter,
  shop: TrialShop,
): Promise<{ ok: true; skus: string[] } | { ok: false; error: string }> {
  const found = await db.from('garments').select('sku').eq('shop_id', shop.shop_id);
  if (found.error) return failed(`garments lookup: ${found.error.message}`);
  const present = readSkus(found.data);

  for (const fixture of TRIAL_FIXTURES) {
    if (present.has(fixture.sku)) continue;
    const result = await upsertOne(db, shop, fixture);
    if (!result.ok) return result;
  }
  return { ok: true, skus: TRIAL_FIXTURES.map((fixture) => fixture.sku) };
}
