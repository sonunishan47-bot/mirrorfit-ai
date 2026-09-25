/**
 * Inserts one labelled TEST FIXTURE TOP into the shop that already has an
 * enrolled kiosk display. Operator-only. Uses the secret key the same way
 * provision-tenant does. Never an HTTP route.
 *
 * Usage: pnpm --filter @mirrorfit/web seed-test-fixture-garment
 *
 * Idempotent on shop_id + sku TEST-FIXTURE-TOP. Not a commercial product.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient } from '@supabase/supabase-js';

const SKU = 'TEST-FIXTURE-TOP';
const NAME = 'TEST FIXTURE TOP';
const DESCRIPTION =
  'Not a commercial product. Geometric overlay fixture for Phase 5 acceptance. TEST_FIXTURE_ASSET.';

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
  const organizationId = display.organization_id;
  const shopId = display.shop_id;

  const { data: existing, error: existingError } = await supabase
    .from('garments')
    .select('id, name, sku, is_active')
    .eq('shop_id', shopId)
    .eq('sku', SKU)
    .maybeSingle();
  if (existingError) throw new Error(`garments lookup: ${existingError.message}`);

  let garmentId = existing?.id ?? null;
  if (!garmentId) {
    const { data: inserted, error: insertError } = await supabase
      .from('garments')
      .insert({
        organization_id: organizationId,
        shop_id: shopId,
        sku: SKU,
        name: NAME,
        description: DESCRIPTION,
        category: 'Tops',
        brand: 'TEST FIXTURE',
        price_minor: null,
        currency_code: null,
        is_active: true,
      })
      .select('id')
      .single();
    if (insertError) throw new Error(`garments insert: ${insertError.message}`);
    garmentId = inserted.id;
  } else {
    const { error: updateError } = await supabase
      .from('garments')
      .update({
        name: NAME,
        description: DESCRIPTION,
        category: 'Tops',
        brand: 'TEST FIXTURE',
        is_active: true,
      })
      .eq('id', garmentId)
      .eq('shop_id', shopId);
    if (updateError) throw new Error(`garments update: ${updateError.message}`);
  }

  const { data: variant, error: variantError } = await supabase
    .from('garment_variants')
    .select('id')
    .eq('garment_id', garmentId)
    .eq('color_name', 'Fixture Blue')
    .maybeSingle();
  if (variantError) throw new Error(`variants lookup: ${variantError.message}`);

  let variantId = variant?.id ?? null;
  if (!variantId) {
    const { data: insertedVariant, error: insertVariantError } = await supabase
      .from('garment_variants')
      .insert({
        organization_id: organizationId,
        shop_id: shopId,
        garment_id: garmentId,
        color_name: 'Fixture Blue',
        color_hex: '#285aa0',
        sku: `${SKU}-BLUE`,
        is_active: true,
      })
      .select('id')
      .single();
    if (insertVariantError) throw new Error(`variants insert: ${insertVariantError.message}`);
    variantId = insertedVariant.id;
  }

  const { data: chart, error: chartError } = await supabase
    .from('size_charts')
    .select('id')
    .eq('garment_id', garmentId)
    .maybeSingle();
  if (chartError) throw new Error(`size_charts lookup: ${chartError.message}`);

  let chartId = chart?.id ?? null;
  if (!chartId) {
    const { data: insertedChart, error: insertChartError } = await supabase
      .from('size_charts')
      .insert({
        organization_id: organizationId,
        shop_id: shopId,
        garment_id: garmentId,
        name: 'TEST FIXTURE TOP chart',
      })
      .select('id')
      .single();
    if (insertChartError) throw new Error(`size_charts insert: ${insertChartError.message}`);
    chartId = insertedChart.id;
  }

  for (const label of ['S', 'M', 'L']) {
    const { data: measurement, error: measurementLookup } = await supabase
      .from('size_measurements')
      .select('id')
      .eq('size_chart_id', chartId)
      .eq('size_label', label)
      .maybeSingle();
    if (measurementLookup) throw new Error(`size_measurements lookup: ${measurementLookup.message}`);
    if (measurement) continue;
    const { error: measurementError } = await supabase.from('size_measurements').insert({
      organization_id: organizationId,
      shop_id: shopId,
      size_chart_id: chartId,
      size_label: label,
      chest_cm: label === 'S' ? 90 : label === 'M' ? 98 : 106,
      shoulder_cm: label === 'S' ? 42 : label === 'M' ? 45 : 48,
    });
    if (measurementError) throw new Error(`size_measurements insert: ${measurementError.message}`);
  }

  const metadata = {
    fixture_kind: 'TEST_FIXTURE_ASSET',
    overlay: 'geometric-shirt',
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
  if (assetLookup) throw new Error(`garment_assets lookup: ${assetLookup.message}`);
  if (!asset) {
    const { error: assetError } = await supabase.from('garment_assets').insert({
      organization_id: organizationId,
      garment_id: garmentId,
      variant_id: variantId,
      kind: 'FITTING_METADATA',
      version: 1,
      storage_bucket: 'garment-assets',
      storage_path: `fixtures/${SKU}.json`,
      content_hash: contentHash,
      byte_size: payload.length,
      mime_type: 'application/json',
      metadata,
    });
    if (assetError) throw new Error(`garment_assets insert: ${assetError.message}`);
  }

  console.log('TEST FIXTURE TOP is available for the enrolled kiosk shop.');
  console.log(`  name        ${NAME}`);
  console.log(`  sku         ${SKU}`);
  console.log(`  category    Tops`);
  console.log(`  fixture     TEST_FIXTURE_ASSET`);
  console.log(`  shop        ${display.name ?? shopId}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
