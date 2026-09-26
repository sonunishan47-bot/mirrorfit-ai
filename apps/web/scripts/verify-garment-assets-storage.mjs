/**
 * Live Storage access check for the private garment-assets bucket.
 * Prints only boolean outcomes — never signed URLs, keys, or path tokens.
 *
 * Usage (from apps/web):
 *   node --env-file=.env.local scripts/verify-garment-assets-storage.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

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
const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secret = process.env.SUPABASE_SECRET_KEY;

if (!url || !publishable || !secret) {
  console.error('Missing Supabase env in .env.local');
  process.exit(1);
}

const BUCKET = 'garment-assets';
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

let failed = 0;
function check(name, ok) {
  if (ok) console.log(`  PASS  ${name}`);
  else {
    failed += 1;
    console.log(`  FAIL  ${name}`);
  }
}

const anon = createClient(url, publishable, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const admin = createClient(url, secret, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const folder = `verify/${randomUUID()}`;
const objectPath = `${folder}/pixel.png`;

console.log('garment-assets Storage verification (no secrets printed)\n');

{
  const { error } = await anon.storage.from(BUCKET).upload(objectPath, PNG_1X1, {
    contentType: 'image/png',
    upsert: false,
  });
  check('anon upload is denied', Boolean(error));
}

{
  const { error } = await admin.storage.from(BUCKET).upload(objectPath, PNG_1X1, {
    contentType: 'image/png',
    upsert: false,
  });
  check('service-role upload succeeds', !error);
}

{
  const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(objectPath, 60);
  const ok =
    !error &&
    typeof data?.signedUrl === 'string' &&
    data.signedUrl.length > 0 &&
    data.signedUrl.startsWith('http');
  check('service-role createSignedUrl succeeds', ok);
}

{
  const { data, error } = await anon.storage.from(BUCKET).createSignedUrl(objectPath, 60);
  check('anon createSignedUrl is denied', Boolean(error) || !data?.signedUrl);
}

{
  const { data, error } = await anon.storage.from(BUCKET).download(objectPath);
  check('anon download is denied', Boolean(error) || data === null);
}

{
  const { data, error } = await anon.storage.from(BUCKET).list(folder, { limit: 10 });
  const listed = Array.isArray(data) ? data.length : 0;
  check('anon cannot list uploaded object', Boolean(error) || listed === 0);
}

{
  const { error } = await admin.storage.from(BUCKET).remove([objectPath]);
  check('service-role cleanup remove succeeds', !error);
}

console.log(failed === 0 ? '\nAll Storage checks passed.' : `\n${failed} Storage check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
