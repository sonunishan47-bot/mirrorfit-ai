/**
 * Inserts labelled TEST FIXTURE garments into the shop that already has an
 * enrolled kiosk display. Operator-only. Uses the secret key the same way
 * provision-tenant does. Never an HTTP route.
 *
 * Seeds:
 *   - TEST FIXTURE TOP   (category Tops → TOP fitting, geometric shirt)
 *   - TEST FIXTURE PANTS (category Pants → LOWER_BODY, geometric pants)
 *
 * Neither is a commercial product. Neither uploads overlay bytes to the
 * private garment-assets bucket — try-on uses the in-browser fixture bitmaps.
 * FITTING_METADATA rows only record fixture markers (fixtures/*.json paths).
 *
 * Usage: pnpm --filter @mirrorfit/web seed-test-fixture-garment
 *
 * Idempotent on shop_id + sku. Does not modify commercial garments.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient } from '@supabase/supabase-js';

/** @typedef {{ sku: string; name: string; category: string; colorName: string; colorHex: string; variantSku: string; overlay: string; chartName: string; measurements: Array<{ size_label: string; chest_cm?: number; shoulder_cm?: number; waist_cm?: number; hip_cm?: number }> }} FixtureSpec */

/** @type {FixtureSpec} */
const TOP_FIXTURE = {
  sku: 'TEST-FIXTURE-TOP',
  name: 'TEST FIXTURE TOP',
  category: 'Tops',
  colorName: 'Fixture Blue',
  colorHex: '#285aa0',
  variantSku: 'TEST-FIXTURE-TOP-BLUE',
  overlay: 'geometric-shirt',
  chartName: 'TEST FIXTURE TOP chart',
  measurements: [
    { size_label: 'S', chest_cm: 90, shoulder_cm: 42 },
    { size_label: 'M', chest_cm: 98, shoulder_cm: 45 },
    { size_label: 'L', chest_cm: 106, shoulder_cm: 48 },
  ],
};

/** @type {FixtureSpec} */
const PANTS_FIXTURE = {
  sku: 'TEST-FIXTURE-PANTS',
  name: 'TEST FIXTURE PANTS',
  category: 'Pants',
  colorName: 'Fixture Navy',
  colorHex: '#1e3a5f',
  variantSku: 'TEST-FIXTURE-PANTS-NAVY',
  overlay: 'geometric-pants',
  chartName: 'TEST FIXTURE PANTS chart',
  measurements: [
    { size_label: 'S', waist_cm: 76, hip_cm: 92 },
    { size_label: 'M', waist_cm: 84, hip_cm: 100 },
    { size_label: 'L', waist_cm: 92, hip_cm: 108 },
  ],
};

const DESCRIPTION =
  'Not a commercial product. Geometric overlay fixture for Phase 5/6 acceptance. TEST_FIXTURE_ASSET.';

function loadDotEnvLocal() {
  const file = resolve(dirname(fileURLToPath(import.meta.url)), '..', '.env.local');
  const text = readFileSync(file, 'utf8');
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadDotEnvLocal();

async function resolveKioskShop(supabase) {
  const { data: credentials, error: credError } = await supabase
    .from('device_credentials')
    .select('display_id, shop_id, organization_id, revoked_at, expires_at')
    .is('revoked_at', null);

  if (credError) throw new Error(`device_credentials: ${credError.message}`);

  const now = Date.now();
  const live = (credentials ?? []).find((row) => !row.expires_at || Date.parse(row.expires_at) > now);
  if (live) {
    const { data: display } = await supabase
      .from('displays')
      .select('name')
      .eq('id', live.display_id)
      .maybeSingle();
    return {
      name: display?.name ?? 'enrolled display',
      shop_id: live.shop_id,
      organization_id: live.organization_id,
    };
  }

  const { data: shop, error: shopError } = await supabase
    .from('shops')
    .select('id, name, organization_id')
    .limit(1)
    .maybeSingle();
  if (shopError) throw new Error(`shops: ${shopError.message}`);
  if (!shop) throw new Error('No shop exists to attach the test fixture garment.');
  return { name: shop.name, shop_id: shop.id, organization_id: shop.organization_id };
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {{ organization_id: string; shop_id: string; name?: string }} shop
 * @param {FixtureSpec} fixture
 */
async function upsertFixture(supabase, shop, fixture) {
  const organizationId = shop.organization_id;
  const shopId = shop.shop_id;

  const { data: existing, error: existingError } = await supabase
    .from('garments')
    .select('id, name, sku, is_active')
    .eq('shop_id', shopId)
    .eq('sku', fixture.sku)
    .maybeSingle();
  if (existingError) throw new Error(`garments lookup: ${existingError.message}`);

  let garmentId = existing?.id ?? null;
  if (!garmentId) {
    const { data: inserted, error: insertError } = await supabase
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
    if (insertError) throw new Error(`garments insert (${fixture.sku}): ${insertError.message}`);
    garmentId = inserted.id;
  } else {
    const { error: updateError } = await supabase
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
    if (updateError) throw new Error(`garments update (${fixture.sku}): ${updateError.message}`);
  }

  const { data: variant, error: variantError } = await supabase
    .from('garment_variants')
    .select('id')
    .eq('garment_id', garmentId)
    .eq('color_name', fixture.colorName)
    .maybeSingle();
  if (variantError) throw new Error(`variants lookup (${fixture.sku}): ${variantError.message}`);

  let variantId = variant?.id ?? null;
  if (!variantId) {
    const { data: insertedVariant, error: insertVariantError } = await supabase
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
    if (insertVariantError) {
      throw new Error(`variants insert (${fixture.sku}): ${insertVariantError.message}`);
    }
    variantId = insertedVariant.id;
  }

  const { data: chart, error: chartError } = await supabase
    .from('size_charts')
    .select('id')
    .eq('garment_id', garmentId)
    .maybeSingle();
  if (chartError) throw new Error(`size_charts lookup (${fixture.sku}): ${chartError.message}`);

  let chartId = chart?.id ?? null;
  if (!chartId) {
    const { data: insertedChart, error: insertChartError } = await supabase
      .from('size_charts')
      .insert({
        organization_id: organizationId,
        shop_id: shopId,
        garment_id: garmentId,
        name: fixture.chartName,
      })
      .select('id')
      .single();
    if (insertChartError) {
      throw new Error(`size_charts insert (${fixture.sku}): ${insertChartError.message}`);
    }
    chartId = insertedChart.id;
  }

  for (const row of fixture.measurements) {
    const { data: measurement, error: measurementLookup } = await supabase
      .from('size_measurements')
      .select('id')
      .eq('size_chart_id', chartId)
      .eq('size_label', row.size_label)
      .maybeSingle();
    if (measurementLookup) {
      throw new Error(`size_measurements lookup (${fixture.sku}): ${measurementLookup.message}`);
    }
    if (measurement) continue;
    const { error: measurementError } = await supabase.from('size_measurements').insert({
      organization_id: organizationId,
      shop_id: shopId,
      size_chart_id: chartId,
      size_label: row.size_label,
      chest_cm: row.chest_cm ?? null,
      shoulder_cm: row.shoulder_cm ?? null,
      waist_cm: row.waist_cm ?? null,
      hip_cm: row.hip_cm ?? null,
    });
    if (measurementError) {
      throw new Error(`size_measurements insert (${fixture.sku}): ${measurementError.message}`);
    }
  }

  const metadata = {
    fixture_kind: 'TEST_FIXTURE_ASSET',
    overlay: fixture.overlay,
    commercial_product: false,
  };
  const payload = JSON.stringify(metadata);
  const contentHash = createHash('sha256').update(payload).digest('hex');

  const { data: asset, error: assetLookup } = await supabase
    .from('garment_assets')
    .select('id')
    .eq('garment_id', garmentId)
    .eq('kind', 'FITTING_METADATA')
    .eq('version', 1)
    .maybeSingle();
  if (assetLookup) throw new Error(`garment_assets lookup (${fixture.sku}): ${assetLookup.message}`);
  if (!asset) {
    // Metadata marker only — does not upload bytes to Storage.
    const { error: assetError } = await supabase.from('garment_assets').insert({
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
    if (assetError) throw new Error(`garment_assets insert (${fixture.sku}): ${assetError.message}`);
  }

  console.log(`${fixture.name} is available for the enrolled kiosk shop.`);
  console.log(`  name        ${fixture.name}`);
  console.log(`  sku         ${fixture.sku}`);
  console.log(`  category    ${fixture.category}`);
  console.log(`  fixture     TEST_FIXTURE_ASSET (${fixture.overlay})`);
  console.log(`  shop        ${shop.name ?? shopId}`);
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set. ' +
        'Run this through the package script so apps/web/.env.local is loaded.',
    );
  }

  const supabase = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const display = await resolveKioskShop(supabase);
  const shop = {
    organization_id: display.organization_id,
    shop_id: display.shop_id,
    name: display.name,
  };

  await upsertFixture(supabase, shop, TOP_FIXTURE);
  await upsertFixture(supabase, shop, PANTS_FIXTURE);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
