/**
 * Phase 3 end-to-end verification against a running server and the live
 * database.
 *
 * What this covers that unit tests cannot
 * ---------------------------------------
 * Everything up to now has been unit tests plus in-database assertions run
 * inside a rolled-back transaction. Neither exercises the actual request
 * path: env loading, the admin client, Zod parsing at the route boundary,
 * PostgREST's own encoding of function arguments, and the cookie handling in
 * the proxy. This script drives all of it over real HTTP.
 *
 * Secrets
 * -------
 * The owner password is generated here and used here. It is never printed,
 * and neither is the device secret or the pairing token. Only lengths and
 * shapes are reported.
 *
 * Isolation
 * ---------
 * Two complete tenants are provisioned so that cross-tenant attempts have a
 * real second tenant to come from, rather than a fabricated uuid that any
 * lookup would miss for the wrong reason. Both are deleted at the end, in a
 * finally block, so a failed run does not leave rows behind.
 *
 * Usage:
 *   node --env-file=.env.local scripts/e2e-phase3.mjs
 */

import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';

/**
 * Loads `apps/web/.env.local` with file-wins semantics.
 *
 * Node's `--env-file` does not override a variable already present in the
 * process environment. Cursor, a parent shell, or a CI runner can inject
 * `SUPABASE_SECRET_KEY`, and the file the operator just edited is then
 * silently ignored. That is exactly how this script spent several runs
 * authenticating with a 43-character parent-process value instead of the
 * key in `.env.local`, and every 401 was that inherited value being
 * refused.
 *
 * File values win. An empty assignment in the file (`KEY=""`) is treated
 * as empty, not as "keep whatever the parent had".
 */
function loadDotEnvLocal() {
  const file = resolve(dirname(fileURLToPath(import.meta.url)), '..', '.env.local');
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    throw new Error(`Could not read ${file}`);
  }

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

  return file;
}

const parentSecretLength = process.env.SUPABASE_SECRET_KEY?.length ?? 0;
const loadedEnvFile = loadDotEnvLocal();

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3111';
const URL_SUPABASE = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY_PUBLISHABLE = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const KEY_SECRET = process.env.SUPABASE_SECRET_KEY;

if (!URL_SUPABASE || !KEY_PUBLISHABLE || !KEY_SECRET) {
  const missing = [
    !URL_SUPABASE && 'NEXT_PUBLIC_SUPABASE_URL',
    !KEY_PUBLISHABLE && 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    !KEY_SECRET && 'SUPABASE_SECRET_KEY',
  ].filter(Boolean);
  console.error(`Missing environment in ${loadedEnvFile}: ${missing.join(', ')}`);
  process.exit(1);
}

const admin = createClient(URL_SUPABASE, KEY_SECRET, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let passed = 0;
let failed = 0;
const failures = [];

function check(name, ok, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${name}${detail ? `  (${detail})` : ''}`);
  } else {
    failed += 1;
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ''}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

/** A password that exists only inside this process. Never printed. */
function throwawayPassword() {
  return `${randomBytes(24).toString('base64url')}Aa1!`;
}

async function postJson(path, body, token) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  return { status: response.status, payload };
}

/**
 * Provisions a tenant through the same function the operator script uses.
 *
 * Returns the ids plus a signed-in RLS-scoped client, which is what the
 * server actions use once they have authorized the caller.
 */
async function provisionTenant(label) {
  const email = `e2e-${label}-${randomUUID()}@mirrorfit.invalid`;
  const password = throwawayPassword();

  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) {
    throw new Error(`createUser failed for ${label}: ${created.error?.message ?? 'unknown'}`);
  }

  const slug = `e2e-${label}-${randomBytes(4).toString('hex')}`;
  const { data, error } = await admin.rpc('provision_organization', {
    p_org_name: `E2E ${label}`,
    p_org_slug: slug,
    p_shop_name: `E2E ${label} shop`,
    p_shop_slug: `${slug}-shop`,
    p_owner_auth_user_id: created.data.user.id,
    p_owner_email: email,
    p_owner_name: `E2E ${label} owner`,
    p_timezone: 'UTC',
  });

  if (error) {
    await admin.auth.admin.deleteUser(created.data.user.id);
    throw new Error(`provision_organization failed for ${label}: ${error.message}`);
  }

  return {
    label,
    email,
    password,
    authUserId: created.data.user.id,
    organizationId: data.organization_id,
    shopId: data.shop_id,
    staffUserId: data.staff_user_id,
  };
}

/**
 * Signs in and returns both an RLS-scoped client and the cookies the web app
 * would have set, so the same session can be replayed against a real page
 * request.
 */
async function signIn(tenant) {
  const jar = new Map();

  const client = createServerClient(URL_SUPABASE, KEY_PUBLISHABLE, {
    cookies: {
      getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => {
        for (const { name, value } of cookies) jar.set(name, value);
      },
    },
  });

  const { data, error } = await client.auth.signInWithPassword({
    email: tenant.email,
    password: tenant.password,
  });

  if (error || !data.session) {
    throw new Error(`sign-in failed for ${tenant.label}: ${error?.message ?? 'no session'}`);
  }

  const cookieHeader = [...jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
  return { client, cookieHeader, userId: data.user.id };
}

async function cleanup(tenants) {
  for (const tenant of tenants) {
    if (!tenant) continue;
    // Deleting the organization cascades to shops, displays, credentials,
    // enrollment codes, sessions and staff rows.
    await admin.from('organizations').delete().eq('id', tenant.organizationId);
    await admin.auth.admin.deleteUser(tenant.authUserId);
  }
}

/**
 * Establishes which Supabase services actually accept the configured key
 * before anything else runs.
 *
 * Without this, a bad key surfaces as "Invalid API key" from whichever call
 * happens to be first, which says nothing about whether the key is
 * malformed, revoked, for the wrong project, or simply the publishable one
 * pasted into the wrong variable. Reports status codes only; the key itself
 * is never printed.
 */
/** The project this checkout is wired to. Not a secret; it is in the URL. */
const EXPECTED_PROJECT_REF = 'ptqqmlsdsgkpqygdsupq';

/**
 * Reports how far a misplaced secret actually travelled.
 *
 * A secret in a NEXT_PUBLIC_ variable does not stay in the env file. Next
 * substitutes those names literally into the client bundle at build time, so
 * every production build since the mistake has a copy on disk, and every
 * page the dev server rendered shipped one to the browser.
 *
 * Only file counts are printed. The value is used to search, never echoed.
 */
async function reportLeak(secret) {
  const { readdir, readFile } = await import('node:fs/promises');
  const { join } = await import('node:path');

  async function scan(dir) {
    let hits = 0;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return 0;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        hits += await scan(full);
      } else if (/\.(js|mjs|cjs|json|html|txt|map)$/.test(entry.name)) {
        try {
          if ((await readFile(full, 'utf8')).includes(secret)) hits += 1;
        } catch {
          /* unreadable file, ignore */
        }
      }
    }
    return hits;
  }

  const buildHits = await scan('.next');
  console.log(`\n  build artifacts under .next containing the secret: ${buildHits}`);
  if (buildHits > 0) {
    console.log('  Delete .next and rebuild AFTER rotating the key.');
  }
}

/**
 * The publishable key the project itself reports.
 *
 * Used only as a control probe. It is safe to hold here because it is
 * already shipped to every browser; that is what "publishable" means.
 */
const KNOWN_PUBLISHABLE_KEY = 'sb_publishable_Ri8gyEUU8FagJUqs1C7EUQ_KpDBHTXs';

async function probeOnce(path, headers) {
  try {
    const response = await fetch(`${URL_SUPABASE}${path}`, { headers });
    const body = (await response.text()).slice(0, 160).replace(/\s+/g, ' ');
    return { status: response.status, ok: response.ok, body };
  } catch (error) {
    return { status: 0, ok: false, body: error.message };
  }
}

/**
 * Tries a credential three ways.
 *
 * Header shape genuinely matters. PostgREST authenticates on `apikey`, while
 * GoTrue's admin API wants a bearer token, and a new-format `sb_secret_` key
 * is not a JWT. If one variant succeeded where another failed, the bug would
 * be in how this script calls Supabase rather than in the key, and that
 * distinction is the whole point of checking before blaming the credential.
 */
async function probeKey(candidate) {
  const variants = {
    'apikey only': { apikey: candidate },
    'bearer only': { Authorization: `Bearer ${candidate}` },
    both: { apikey: candidate, Authorization: `Bearer ${candidate}` },
  };

  const results = {};
  for (const [name, headers] of Object.entries(variants)) {
    results[name] = {
      rest: await probeOnce('/rest/v1/organizations?select=id&limit=1', headers),
      auth: await probeOnce('/auth/v1/admin/users?page=1&per_page=1', headers),
    };
  }
  return results;
}

function anyVariantWorked(results) {
  return Object.entries(results).find(([, r]) => r.rest.ok && r.auth.ok)?.[0] ?? null;
}

async function preflight() {
  // --- environment, before any network call -------------------------------
  const host = new URL(URL_SUPABASE).host;
  const refFromUrl = host.split('.')[0];
  const secretWellFormed = /^sb_secret_[A-Za-z0-9_-]+$/.test(KEY_SECRET);
  const cleaned = KEY_SECRET.trim().replace(/^["']|["']$/g, '');

  console.log(`  env file               ${loadedEnvFile}`);
  console.log(`  cwd                    ${process.cwd()}`);
  console.log(`  parent process had a SUPABASE_SECRET_KEY (shadowed)  ${parentSecretLength > 0}`);
  console.log(`  NEXT_PUBLIC_SUPABASE_URL present            ${Boolean(URL_SUPABASE)}`);
  console.log(`  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY present ${Boolean(KEY_PUBLISHABLE)}`);
  console.log(`  SUPABASE_SECRET_KEY present and non-empty   ${KEY_SECRET.length > 0}`);
  console.log(`  supabase host          ${host}`);
  console.log(
    `  project ref matches ${EXPECTED_PROJECT_REF}   ${refFromUrl === EXPECTED_PROJECT_REF}`,
  );
  console.log(
    `  publishable key is this project's           ${KEY_PUBLISHABLE === KNOWN_PUBLISHABLE_KEY}`,
  );
  if (KEY_PUBLISHABLE !== KNOWN_PUBLISHABLE_KEY) {
    // The publishable key is not a secret; it ships in every browser bundle.
    // Even so, only structural facts are reported, because the useful
    // question is "how is it wrong", not "what is it".
    console.log(`    configured length    ${KEY_PUBLISHABLE.length}`);
    console.log(`    this project's length ${KNOWN_PUBLISHABLE_KEY.length}`);
    console.log(
      `    configured is a truncation of this project's key  ` +
        `${KNOWN_PUBLISHABLE_KEY.startsWith(KEY_PUBLISHABLE)}`,
    );
    console.log(
      `    shares the sb_publishable_ prefix                 ` +
        `${KEY_PUBLISHABLE.startsWith('sb_publishable_')}`,
    );

    // If a secret has been pasted into a NEXT_PUBLIC_ variable it is not a
    // configuration mistake, it is a disclosure: Next inlines these into the
    // client bundle, so the value reaches every browser that loads the app.
    const publishableLooksSecret = KEY_PUBLISHABLE.startsWith('sb_secret_');
    console.log(`    value in the PUBLIC var looks like a SECRET key   ${publishableLooksSecret}`);
    console.log(
      `    public and secret vars hold the same value        ` +
        `${KEY_PUBLISHABLE === KEY_SECRET}`,
    );
    if (publishableLooksSecret) {
      console.log(
        '\n  *** STOP. A secret key is sitting in a NEXT_PUBLIC_ variable. ***\n' +
          '  Next inlines NEXT_PUBLIC_* into the browser bundle, so this value\n' +
          '  would be served to every visitor. Treat it as compromised: rotate\n' +
          '  it in the Supabase dashboard rather than just moving it.',
      );

      // Worth knowing whether the two values were simply swapped, because
      // that changes the instruction from "find the right key" to "move the
      // one you already have and then rotate it".
      const swapped = await probeKey(KEY_PUBLISHABLE);
      const swapWorks = anyVariantWorked(swapped);
      console.log(
        `\n  the misplaced value authenticates as this project's secret: ` +
          `${Boolean(swapWorks)}`,
      );

      if (swapWorks) {
        await reportLeak(KEY_PUBLISHABLE);
      }
    }
  }
  console.log(`  secret key well-formed                      ${secretWellFormed}`);
  console.log(`  secret key free of stray quotes/space       ${cleaned === KEY_SECRET}`);

  // --- control probe ------------------------------------------------------
  // Proves the URL and project accept credentials at all. The publishable
  // key must NOT be able to read this table: anon has no policy and no
  // grant. So the useful signal is *which* refusal comes back. A permission
  // error means the key was recognised and then denied, which is correct. An
  // "Invalid API key" would mean the endpoint rejects keys outright, and
  // would point at the URL rather than at any one credential.
  const control = await probeOnce('/rest/v1/organizations?select=id&limit=1', {
    apikey: KNOWN_PUBLISHABLE_KEY,
  });
  const controlRecognised = !/invalid api key/i.test(control.body);
  console.log(`\n  control: publishable key -> PostgREST HTTP ${control.status}`);
  console.log(`  control: key was recognised by the project  ${controlRecognised}`);

  // --- the secret key, three header shapes --------------------------------
  const results = await probeKey(KEY_SECRET);
  console.log('');
  for (const [variant, r] of Object.entries(results)) {
    console.log(
      `  secret via ${variant.padEnd(11)} -> PostgREST ${String(r.rest.status).padEnd(4)}` +
        ` GoTrue ${String(r.auth.status).padEnd(4)} ${r.rest.body}`,
    );
  }

  const working = anyVariantWorked(results);
  if (working) {
    console.log(`\n  key is valid; working header shape: ${working}`);
    return;
  }

  // --- classify -----------------------------------------------------------
  const lines = ['', 'The configured SUPABASE_SECRET_KEY was rejected.', ''];

  if (cleaned !== KEY_SECRET) {
    const retry = await probeKey(cleaned);
    if (anyVariantWorked(retry)) {
      lines.push(
        'CAUSE: the value works once surrounding quotes or whitespace are',
        'stripped. The .env.local line has stray characters around the key.',
      );
      throw new Error(lines.join('\n'));
    }
    lines.push('Stripping quotes and whitespace did not help either.', '');
  }

  if (refFromUrl !== EXPECTED_PROJECT_REF) {
    lines.push(
      `CAUSE: NEXT_PUBLIC_SUPABASE_URL points at ref "${refFromUrl}" but this`,
      `checkout's migrations were applied to "${EXPECTED_PROJECT_REF}".`,
    );
    throw new Error(lines.join('\n'));
  }

  if (!controlRecognised) {
    lines.push(
      'CAUSE: even the known-good publishable key is not recognised at this',
      'URL, so the problem is the URL or the project, not the secret key.',
    );
    throw new Error(lines.join('\n'));
  }

  lines.push(
    'Every header shape was refused by BOTH PostgREST and GoTrue, while the',
    'publishable key for this same project WAS recognised at the same URL.',
    '',
    'That combination rules out: a wrong URL, a wrong project ref, a bad',
    'header shape, and stray characters in the file. The only remaining',
    'explanation is the secret value itself. In order of likelihood:',
    '  1. it was copied from a different Supabase project',
    '  2. only part of it was copied',
    '  3. it has been revoked or disabled in the dashboard',
    '',
    `Project ${EXPECTED_PROJECT_REF}: Dashboard -> Project Settings ->`,
    'API Keys -> Secret keys. Replace the value in apps/web/.env.local.',
    '',
    'This is a credential problem, not a code problem. Nothing in the',
    'application or this script should be changed to get past it.',
  );
  throw new Error(lines.join('\n'));
}

async function main() {
  console.log(`Phase 3 E2E against ${BASE_URL}\n${'='.repeat(60)}`);

  const health = await fetch(`${BASE_URL}/api/health`).catch(() => null);
  if (!health || !health.ok) {
    throw new Error(`Server is not answering at ${BASE_URL}. Start the dev server first.`);
  }

  section('0. Credential preflight');
  await preflight();

  let tenantA = null;
  let tenantB = null;

  try {
    // ---------------------------------------------------------------- 1
    section('1. Provision tenant');
    tenantA = await provisionTenant('a');
    tenantB = await provisionTenant('b');
    check('tenant A provisioned', Boolean(tenantA.organizationId && tenantA.shopId));
    check('tenant B provisioned', Boolean(tenantB.organizationId && tenantB.shopId));
    check(
      'owner is ORG_OWNER with organization-wide scope',
      await (async () => {
        const { data } = await admin
          .from('staff_users')
          .select('role, shop_id')
          .eq('id', tenantA.staffUserId)
          .single();
        return data?.role === 'ORG_OWNER' && data?.shop_id === null;
      })(),
    );

    // ---------------------------------------------------------------- 2
    section('2. Login');
    const sessionA = await signIn(tenantA);
    const sessionB = await signIn(tenantB);
    check('tenant A owner signed in', Boolean(sessionA.cookieHeader.length));
    check('tenant B owner signed in', Boolean(sessionB.cookieHeader.length));

    const wrongPassword = await createClient(URL_SUPABASE, KEY_PUBLISHABLE, {
      auth: { persistSession: false },
    }).auth.signInWithPassword({ email: tenantA.email, password: 'not-the-password' });
    check('wrong password is refused', Boolean(wrongPassword.error));

    const anonDisplays = await fetch(`${BASE_URL}/displays`, { redirect: 'manual' });
    check(
      'anonymous /displays redirects to login',
      anonDisplays.status === 307 || anonDisplays.status === 302,
      `status ${anonDisplays.status}`,
    );

    // ---------------------------------------------------------------- 3
    section('3. Create display');
    const displaySlug = `mirror-${randomBytes(3).toString('hex')}`;
    const { data: displayA, error: displayError } = await sessionA.client
      .from('displays')
      .insert({
        organization_id: tenantA.organizationId,
        shop_id: tenantA.shopId,
        name: 'E2E Mirror A',
        slug: displaySlug,
      })
      .select('id, name, slug, status')
      .single();

    check(
      'staff created a display through RLS',
      !displayError && Boolean(displayA?.id),
      displayError?.message ?? `status ${displayA?.status}`,
    );

    const authedPage = await fetch(`${BASE_URL}/displays`, {
      headers: { cookie: sessionA.cookieHeader },
      redirect: 'manual',
    });
    const pageHtml = authedPage.ok ? await authedPage.text() : '';
    check(
      'authenticated /displays renders',
      authedPage.status === 200,
      `status ${authedPage.status}`,
    );
    check('the new display appears on the page', pageHtml.includes('E2E Mirror A'));
    check('no secret key leaked into the HTML', !pageHtml.includes('sb_secret_'));

    // tenant isolation on read
    const { data: crossRead } = await sessionB.client
      .from('displays')
      .select('id')
      .eq('id', displayA.id)
      .maybeSingle();
    check('tenant B cannot see tenant A display', crossRead === null);

    // column grants still hold
    const starCredentials = await sessionA.client.from('device_credentials').select();
    check(
      'select * on device_credentials is denied',
      Boolean(starCredentials.error),
      starCredentials.error?.code ?? 'no error',
    );

    const hashRead = await sessionA.client.from('sessions').select('pairing_token_hash');
    check(
      'pairing_token_hash is unreadable by staff',
      Boolean(hashRead.error),
      hashRead.error?.code ?? 'no error',
    );

    // ---------------------------------------------------------------- 4
    section('4. Enroll device');
    const enrollmentCode = await issueCode(displayA.id, tenantA.staffUserId);
    const enroll = await postJson('/api/device/enroll', {
      code: enrollmentCode,
      app_version: '1.2.3',
      screen_width: 2160,
      screen_height: 3840,
      hardware_info: { gpu: 'test' },
    });

    check('enroll returned 200', enroll.status === 200, `status ${enroll.status}`);
    check(
      'a device secret was issued',
      typeof enroll.payload?.device_secret === 'string',
      `length ${enroll.payload?.device_secret?.length ?? 0}`,
    );
    check('enroll reported the right display', enroll.payload?.display?.id === displayA.id);

    const deviceSecretAInitial = enroll.payload.device_secret;
    let deviceSecretA = deviceSecretAInitial;

    const replayEnroll = await postJson('/api/device/enroll', { code: enrollmentCode });
    check(
      'the same code cannot be used twice',
      replayEnroll.status === 400,
      `status ${replayEnroll.status}, ${replayEnroll.payload?.error}`,
    );

    const { data: afterEnroll } = await admin
      .from('displays')
      .select('status, app_version, screen_width, screen_height')
      .eq('id', displayA.id)
      .single();
    check('display came online', afterEnroll?.status === 'ONLINE');
    check(
      'display recorded its hardware',
      afterEnroll?.app_version === '1.2.3' && afterEnroll?.screen_width === 2160,
    );

    const { count: installCount } = await admin
      .from('installations')
      .select('id', { count: 'exact', head: true })
      .eq('display_id', displayA.id);
    check('an installation record was opened', installCount === 1, `count ${installCount}`);

    // ---------------------------------------------------------------- 4b
    section('4b. Re-enroll revokes prior credential');
    const reenrollCode = await issueCode(displayA.id, tenantA.staffUserId);
    const reenroll = await postJson('/api/device/enroll', {
      code: reenrollCode,
      app_version: '1.2.3',
    });
    check('re-enroll returned 200', reenroll.status === 200, `status ${reenroll.status}`);
    const deviceSecretAReplaced = reenroll.payload?.device_secret;
    check(
      're-enroll issued a new device secret',
      typeof deviceSecretAReplaced === 'string' && deviceSecretAReplaced !== deviceSecretAInitial,
    );

    const { data: activeCreds } = await admin
      .from('device_credentials')
      .select('id')
      .eq('display_id', displayA.id)
      .is('revoked_at', null);
    check(
      'exactly one active credential remains after re-enroll',
      activeCreds?.length === 1,
      `count ${activeCreds?.length}`,
    );

    const oldSecretHeartbeat = await postJson(
      '/api/device/heartbeat',
      { camera_ok: true },
      deviceSecretAInitial,
    );
    check(
      'old secret is rejected after re-enroll',
      oldSecretHeartbeat.status === 401,
      `status ${oldSecretHeartbeat.status}`,
    );

    deviceSecretA = deviceSecretAReplaced;

    // ---------------------------------------------------------------- 5
    section('5. Heartbeat');
    const heartbeat = await postJson(
      '/api/device/heartbeat',
      {
        app_version: '1.2.3',
        camera_ok: true,
        render_fps: 59.5,
        // Deliberately null: the mirror did not measure this.
        processing_fps: null,
        metrics: { queue_depth: 2 },
      },
      deviceSecretA,
    );
    check('heartbeat accepted', heartbeat.status === 200, `status ${heartbeat.status}`);

    const { data: hbRow } = await admin
      .from('device_heartbeats')
      .select('render_fps, processing_fps, camera_ok')
      .eq('display_id', displayA.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    check('render_fps was stored', Number(hbRow?.render_fps) === 59.5, `${hbRow?.render_fps}`);
    check(
      'unmeasured processing_fps stayed null, not zero',
      hbRow?.processing_fps === null,
      `${hbRow?.processing_fps}`,
    );

    const badHeartbeat = await postJson(
      '/api/device/heartbeat',
      { camera_ok: true },
      'not-a-secret',
    );
    check(
      'heartbeat rejects a bogus bearer',
      badHeartbeat.status === 401,
      `status ${badHeartbeat.status}`,
    );

    const noAuthHeartbeat = await postJson('/api/device/heartbeat', { camera_ok: true });
    check(
      'heartbeat rejects a missing bearer',
      noAuthHeartbeat.status === 401,
      `status ${noAuthHeartbeat.status}`,
    );

    // ---------------------------------------------------------------- 6
    section('6. Create session');
    const created = await postJson('/api/session/create', { ttl_seconds: 300 }, deviceSecretA);
    check('session created', created.status === 200, `status ${created.status}`);
    check('status is WAITING', created.payload?.status === 'WAITING');
    check('a pairing url was returned', typeof created.payload?.pairing_url === 'string');

    const tokenA = new URL(created.payload.pairing_url).searchParams.get('t');
    check(
      'the pairing url carries a token',
      typeof tokenA === 'string' && tokenA.length === 43,
      `length ${tokenA?.length ?? 0}`,
    );

    const unauthCreate = await postJson('/api/session/create', {});
    check(
      'session create requires a device',
      unauthCreate.status === 401,
      `status ${unauthCreate.status}`,
    );

    // ---------------------------------------------------------------- 7
    section('7. Claim session');
    const claim = await postJson('/api/session/claim', { token: tokenA });
    check('claim accepted', claim.status === 200, `status ${claim.status}`);
    check('status is PAIRED', claim.payload?.status === 'PAIRED');
    check(
      'claim discloses no tenancy to the phone',
      claim.payload?.display_id === undefined &&
        claim.payload?.shop_id === undefined &&
        claim.payload?.organization_id === undefined,
    );

    const activate = await postJson(
      '/api/session/activate',
      { session_id: created.payload.session_id },
      deviceSecretA,
    );
    check(
      'mirror activated the session',
      activate.status === 200 && activate.payload?.status === 'ACTIVE',
      `status ${activate.status}`,
    );

    // ---------------------------------------------------------------- 8
    section('8. Replay protection');
    const replayClaim = await postJson('/api/session/claim', { token: tokenA });
    check(
      'a claimed token cannot be claimed again',
      replayClaim.status === 400,
      `status ${replayClaim.status}, ${replayClaim.payload?.error}`,
    );
    check('replay gives the same opaque code', replayClaim.payload?.error === 'INVALID_TOKEN');

    const unknownToken = await postJson('/api/session/claim', { token: 'z'.repeat(43) });
    check(
      'an unknown token is indistinguishable from a used one',
      unknownToken.status === replayClaim.status &&
        unknownToken.payload?.error === replayClaim.payload?.error,
    );

    const malformedToken = await postJson('/api/session/claim', { token: 'too-short' });
    check(
      'a malformed token gives the same answer too',
      malformedToken.payload?.error === 'INVALID_TOKEN',
    );

    // ---------------------------------------------------------------- 9
    section('9. Tenant isolation');
    const displaySlugB = `mirror-${randomBytes(3).toString('hex')}`;
    const { data: displayB } = await sessionB.client
      .from('displays')
      .insert({
        organization_id: tenantB.organizationId,
        shop_id: tenantB.shopId,
        name: 'E2E Mirror B',
        slug: displaySlugB,
      })
      .select('id')
      .single();

    const codeB = await issueCode(displayB.id, tenantB.staffUserId);
    const enrollB = await postJson('/api/device/enroll', { code: codeB });
    const deviceSecretB = enrollB.payload.device_secret;
    check('tenant B enrolled its own mirror', enrollB.status === 200);

    const crossEnd = await postJson(
      '/api/session/end',
      {
        session_id: created.payload.session_id,
        reason: 'CUSTOMER_ENDED',
      },
      deviceSecretB,
    );
    check(
      "tenant B cannot end tenant A's session",
      crossEnd.status === 400,
      `status ${crossEnd.status}, ${crossEnd.payload?.error}`,
    );

    const { data: stillLive } = await admin
      .from('sessions')
      .select('status')
      .eq('id', created.payload.session_id)
      .single();
    check(
      "tenant A's session survived the attempt",
      stillLive?.status === 'ACTIVE',
      `status ${stillLive?.status}`,
    );

    const crossActivate = await postJson(
      '/api/session/activate',
      { session_id: created.payload.session_id },
      deviceSecretB,
    );
    check("tenant B cannot activate tenant A's session", crossActivate.status === 400);

    // a revoked credential must stop working and mark the display REVOKED
    await admin
      .from('device_credentials')
      .update({ revoked_at: new Date().toISOString() })
      .eq('display_id', displayB.id)
      .is('revoked_at', null);
    const { data: revokedDisplay } = await admin
      .from('displays')
      .select('status')
      .eq('id', displayB.id)
      .single();
    check(
      'revoking a credential sets displays.status to REVOKED',
      revokedDisplay?.status === 'REVOKED',
      `status ${revokedDisplay?.status}`,
    );
    const revokedHeartbeat = await postJson(
      '/api/device/heartbeat',
      { camera_ok: true },
      deviceSecretB,
    );
    check(
      'a revoked credential is refused',
      revokedHeartbeat.status === 401,
      `status ${revokedHeartbeat.status}`,
    );

    // ---------------------------------------------------------------- 10
    section('10. Session end and reset');
    const reset = await postJson('/api/session/create', { ttl_seconds: 300 }, deviceSecretA);
    check('a new session can be opened on the same mirror', reset.status === 200);
    check(
      'it superseded the previous one',
      reset.payload?.session_id !== created.payload.session_id,
    );

    const { data: supersededRow } = await admin
      .from('sessions')
      .select('status, end_reason')
      .eq('id', created.payload.session_id)
      .single();
    check(
      'the abandoned session was closed',
      supersededRow?.status === 'ENDED' && supersededRow?.end_reason === 'DISCONNECTED',
      `${supersededRow?.status}/${supersededRow?.end_reason}`,
    );

    const { count: liveCount } = await admin
      .from('sessions')
      .select('id', { count: 'exact', head: true })
      .eq('display_id', displayA.id)
      .in('status', ['WAITING', 'PAIRED', 'ACTIVE']);
    check('exactly one live session remains on the mirror', liveCount === 1, `count ${liveCount}`);

    const end = await postJson(
      '/api/session/end',
      {
        session_id: reset.payload.session_id,
        reason: 'CUSTOMER_ENDED',
      },
      deviceSecretA,
    );
    check(
      'session ended',
      end.status === 200 && end.payload?.status === 'ENDED',
      `status ${end.status}`,
    );
    check('end was not already ended', end.payload?.already_ended === false);

    const endAgain = await postJson(
      '/api/session/end',
      {
        session_id: reset.payload.session_id,
        reason: 'ERROR',
      },
      deviceSecretA,
    );
    check('ending twice is idempotent', endAgain.payload?.already_ended === true);
    check(
      'the original reason was not overwritten',
      endAgain.payload?.end_reason === 'CUSTOMER_ENDED',
      `${endAgain.payload?.end_reason}`,
    );

    const forbiddenReason = await postJson(
      '/api/session/end',
      {
        session_id: reset.payload.session_id,
        reason: 'STAFF_RESET',
      },
      deviceSecretA,
    );
    check(
      'a device cannot claim STAFF_RESET',
      forbiddenReason.status === 400,
      `status ${forbiddenReason.status}`,
    );

    const { count: liveAfterEnd } = await admin
      .from('sessions')
      .select('id', { count: 'exact', head: true })
      .eq('display_id', displayA.id)
      .in('status', ['WAITING', 'PAIRED', 'ACTIVE']);
    check('the mirror is free for the next customer', liveAfterEnd === 0, `count ${liveAfterEnd}`);

    // The HTTP enroll route is the only audited path this harness drives.
    // Display creation and code issuance go through the RLS client / RPC
    // directly, because those staff operations are Next server actions with
    // no stable URL. Expecting two rows was a harness mistake, not an
    // application gap: DEVICE_ENROLLED is the write the enroll route claims.
    const { data: enrollAudit } = await admin
      .from('audit_logs')
      .select('action, actor_kind, metadata')
      .eq('organization_id', tenantA.organizationId)
      .eq('action', 'DEVICE_ENROLLED')
      .maybeSingle();
    check(
      'HTTP enroll wrote a DEVICE_ENROLLED audit row',
      enrollAudit?.actor_kind === 'DEVICE',
      enrollAudit?.action ?? 'missing',
    );
    const metadataText = JSON.stringify(enrollAudit?.metadata ?? {});
    check(
      'the audit row does not store a secret or hash',
      !/sb_secret_|device_secret|secret_hash|[0-9a-f]{64}/i.test(metadataText),
    );
  } finally {
    section('Cleanup');
    await cleanup([tenantA, tenantB]);
    console.log('  test tenants deleted');
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log(`\nFailures:\n${failures.map((f) => `  - ${f}`).join('\n')}`);
    process.exitCode = 1;
  }
}

/**
 * Issues an enrollment code the way the staff action does: generate the
 * plaintext here, send only its hash. Returns the plaintext for the device
 * to present, which is the one place it exists.
 */
async function issueCode(displayId, staffId) {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let code = '';
  for (const byte of randomBytes(12)) code += alphabet[byte % 32];

  const { createHash } = await import('node:crypto');
  const hash = createHash('sha256').update(code, 'utf8').digest('hex');

  const { error } = await admin.rpc('issue_device_enrollment_code', {
    p_display_id: displayId,
    p_staff_id: staffId,
    p_code_hash: hash,
    p_ttl_seconds: 600,
  });

  if (error) throw new Error(`issue_device_enrollment_code failed: ${error.message}`);
  return code;
}

main().catch((error) => {
  console.error(`\nFATAL: ${error instanceof Error ? error.message : error}`);
  process.exitCode = 1;
});
