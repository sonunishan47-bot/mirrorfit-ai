/**
 * Live check: revoking a credential sets displays.status = REVOKED.
 * Prints only statuses — never secrets.
 *
 * Usage (from apps/web):
 *   node --env-file=.env.local scripts/verify-revoke-display-status.mjs
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient } from '@supabase/supabase-js';

function loadEnv() {
  const file = resolve(dirname(fileURLToPath(import.meta.url)), '..', '.env.local');
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
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

loadEnv();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
if (!url || !secret) {
  console.error('Missing Supabase env');
  process.exit(1);
}

const admin = createClient(url, secret, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let failed = 0;
function check(name, ok, detail = '') {
  if (ok) console.log(`  PASS  ${name}${detail ? ` (${detail})` : ''}`);
  else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? ` (${detail})` : ''}`);
  }
}

const slug = `p15-${randomBytes(4).toString('hex')}`;
const email = `p15-${randomUUID()}@mirrorfit.invalid`;

console.log('revoke → display REVOKED verification\n');

const created = await admin.auth.admin.createUser({
  email,
  password: `${randomBytes(24).toString('base64url')}Aa1!`,
  email_confirm: true,
});
if (created.error || !created.data.user) {
  console.error('createUser failed');
  process.exit(1);
}

const authUserId = created.data.user.id;
let organizationId = null;

try {
  const { data: provisioned, error: provisionError } = await admin.rpc('provision_organization', {
    p_org_name: `P15 ${slug}`,
    p_org_slug: slug,
    p_shop_name: `P15 shop`,
    p_shop_slug: `${slug}-shop`,
    p_owner_auth_user_id: authUserId,
    p_owner_email: email,
    p_owner_name: 'P15',
    p_timezone: 'UTC',
  });
  if (provisionError || !provisioned)
    throw new Error(provisionError?.message ?? 'provision failed');

  organizationId = provisioned.organization_id;
  const shopId = provisioned.shop_id;

  const { data: display, error: displayError } = await admin
    .from('displays')
    .insert({
      organization_id: organizationId,
      shop_id: shopId,
      name: 'P15 Mirror',
      slug: 'p15-mirror',
      status: 'ONLINE',
    })
    .select('id, status')
    .single();
  if (displayError || !display) throw new Error(displayError?.message ?? 'display insert failed');
  check('display starts ONLINE', display.status === 'ONLINE', display.status);

  const secretHash = createHash('sha256').update(randomBytes(32)).digest('hex');
  const { data: credential, error: credError } = await admin
    .from('device_credentials')
    .insert({
      organization_id: organizationId,
      shop_id: shopId,
      display_id: display.id,
      secret_hash: secretHash,
      label: 'P15',
    })
    .select('id')
    .single();
  if (credError || !credential) throw new Error(credError?.message ?? 'credential insert failed');

  const { data: failedRevoke } = await admin
    .from('device_credentials')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', '00000000-0000-4000-8000-000000000000')
    .is('revoked_at', null)
    .select('id')
    .maybeSingle();
  const { data: stillOnline } = await admin
    .from('displays')
    .select('status')
    .eq('id', display.id)
    .single();
  check('failed revoke leaves display ONLINE', !failedRevoke && stillOnline?.status === 'ONLINE');

  const { error: revokeError } = await admin
    .from('device_credentials')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', credential.id)
    .is('revoked_at', null);
  check('credential revoke update succeeds', !revokeError);

  const { data: after } = await admin
    .from('displays')
    .select('status')
    .eq('id', display.id)
    .single();
  check('display.status is REVOKED after revoke', after?.status === 'REVOKED', after?.status);

  const otherOrg = await admin.rpc('provision_organization', {
    p_org_name: `P15b ${slug}`,
    p_org_slug: `${slug}b`,
    p_shop_name: `P15b shop`,
    p_shop_slug: `${slug}b-shop`,
    p_owner_auth_user_id: authUserId,
    p_owner_email: email,
    p_owner_name: 'P15b',
    p_timezone: 'UTC',
  });
  // Second provision may fail (user already owns org) — skip cross-tenant if so.
  void otherOrg;
} catch (error) {
  failed += 1;
  console.log(`  FAIL  setup/verify (${error instanceof Error ? error.message : 'error'})`);
} finally {
  if (organizationId) {
    await admin.from('organizations').delete().eq('id', organizationId);
  }
  await admin.auth.admin.deleteUser(authUserId);
}

console.log(failed === 0 ? '\nAll revoke→REVOKED checks passed.' : `\n${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
