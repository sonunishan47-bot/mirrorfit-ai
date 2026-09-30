/**
 * Inserts labelled trial shirt and pants into the shop that already has an
 * enrolled kiosk display. Operator-only. Uses the secret key the same way
 * provision-tenant does. Never an HTTP route.
 *
 * The same rows are also created the first time that shop's catalog is read
 * (`ensureTrialGarments`). This script is the explicit operator path.
 *
 * Neither garment is a commercial product. Neither uploads overlay bytes.
 * The mirror draws the in-browser geometric shirt and pants.
 *
 * Usage: pnpm --filter @mirrorfit/web seed-test-fixture-garment
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient } from '@supabase/supabase-js';

import { ensureTrialGarments } from '../src/lib/catalog/trial-garments.ts';

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
  const live = (credentials ?? []).find(
    (row) => !row.expires_at || Date.parse(row.expires_at) > now,
  );
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
  const result = await ensureTrialGarments(supabase, {
    organization_id: display.organization_id,
    shop_id: display.shop_id,
    name: display.name,
  });
  if (!result.ok) throw new Error(result.error);

  console.log('Trial shirt and pants are available for the enrolled kiosk shop.');
  console.log(`  skus   ${result.skus.join(', ')}`);
  console.log(`  shop   ${display.name ?? display.shop_id}`);
  console.log('  draw   in-browser geometric overlay — not a product photo');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
