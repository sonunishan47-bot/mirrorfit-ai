/**
 * Creates the first organization, shop and owner for a deployment.
 *
 * Why this exists
 * ---------------
 * `organizations` has no INSERT policy and `staff_users_insert` requires a
 * caller who is already an admin. Both are deliberate: provisioning a tenant
 * is not an operation for someone already inside a tenant. The consequence is
 * that a fresh database has no way in, because there is no first admin to
 * create the second one.
 *
 * This is the way in, and it is deliberately not an HTTP route. It runs from
 * an operator's machine with the secret key, which is the same trust level
 * that could edit the database directly anyway. Exposing it over the network
 * would turn "no way in" into "one unauthenticated endpoint away from a new
 * tenant".
 *
 * Usage
 * -----
 *   pnpm --filter @mirrorfit/web provision-tenant \
 *     --org "Acme Retail" --org-slug acme \
 *     --shop "Downtown" --shop-slug downtown \
 *     --email owner@acme.example --name "Jane Doe"
 *
 * The generated password is printed once and never stored. Change it after
 * the first sign-in.
 */

import { randomBytes } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = value;
      i += 1;
    }
  }
  return args;
}

function required(args, name) {
  const value = args[name];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Missing --${name}`);
  }
  return value.trim();
}

/**
 * A password nobody is expected to memorise.
 *
 * Generated rather than accepted as an argument so it never lands in a shell
 * history file.
 */
function generatePassword() {
  return `${randomBytes(24).toString('base64url')}Aa1!`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;

  if (!url || !secret) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set. ' +
        'Run this through the package script so apps/web/.env.local is loaded.',
    );
  }

  const orgName = required(args, 'org');
  const orgSlug = required(args, 'org-slug');
  const shopName = required(args, 'shop');
  const shopSlug = required(args, 'shop-slug');
  const email = required(args, 'email');
  const fullName = typeof args.name === 'string' ? args.name : null;
  const timezone = typeof args.timezone === 'string' ? args.timezone : 'UTC';

  const supabase = createClient(url, secret, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // The Auth user is created first and separately, so that no password ever
  // passes through the provisioning function or the database schema.
  const password = generatePassword();
  const created = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (created.error || !created.data.user) {
    throw new Error(`Could not create the auth user: ${created.error?.message ?? 'unknown error'}`);
  }

  const authUserId = created.data.user.id;

  const { data, error } = await supabase.rpc('provision_organization', {
    p_org_name: orgName,
    p_org_slug: orgSlug,
    p_shop_name: shopName,
    p_shop_slug: shopSlug,
    p_owner_auth_user_id: authUserId,
    p_owner_email: email,
    p_owner_name: fullName,
    p_timezone: timezone,
  });

  if (error) {
    // The Auth user exists but has no staff row, so it can sign in and see
    // nothing. Removing it keeps a failed run from leaving a half-tenant
    // behind that the next attempt would collide with on the unique email.
    await supabase.auth.admin.deleteUser(authUserId);
    throw new Error(`Provisioning failed and the auth user was rolled back: ${error.message}`);
  }

  console.log('Tenant provisioned.\n');
  console.log(`  organization  ${data.organization_id}  (${orgName})`);
  console.log(`  shop          ${data.shop_id}  (${shopName})`);
  console.log(`  owner         ${email}  ORG_OWNER`);
  console.log('\nOne-time password, shown once and not stored anywhere:\n');
  console.log(`  ${password}\n`);
  console.log('Sign in at /login and change it.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
