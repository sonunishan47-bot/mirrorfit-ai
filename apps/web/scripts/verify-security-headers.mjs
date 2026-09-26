/**
 * Hit a running MirrorFit web origin and assert security headers.
 * Prints header names/values that are safe (no secrets).
 *
 *   node --env-file=.env.local scripts/verify-security-headers.mjs
 *   SECURITY_HEADERS_BASE_URL=http://127.0.0.1:3000 node scripts/verify-security-headers.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function loadEnv() {
  const file = resolve(dirname(fileURLToPath(import.meta.url)), '..', '.env.local');
  try {
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
      if (process.env[key] === undefined) process.env[key] = value;
    }
  } catch {
    // optional
  }
}

loadEnv();

const base = (process.env.SECURITY_HEADERS_BASE_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const expectProduction = process.env.SECURITY_HEADERS_EXPECT_PRODUCTION !== '0';
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';

let failed = 0;
function check(name, ok, detail = '') {
  if (ok) console.log(`  PASS  ${name}${detail ? ` (${detail})` : ''}`);
  else {
    failed += 1;
    console.log(`  FAIL  ${name}${detail ? ` (${detail})` : ''}`);
  }
}

console.log(`security headers verification → ${base}\n`);

const response = await fetch(`${base}/api/health`, { redirect: 'manual' });
check('health reachable', response.ok, String(response.status));

const csp = response.headers.get('content-security-policy') ?? '';
const hsts = response.headers.get('strict-transport-security');
const xfo = response.headers.get('x-frame-options');
const nosniff = response.headers.get('x-content-type-options');
const referrer = response.headers.get('referrer-policy');
const permissions = response.headers.get('permissions-policy');

check('CSP present', csp.length > 0);
check('CSP frame-ancestors none', csp.includes("frame-ancestors 'none'"));
check('CSP wasm-unsafe-eval', csp.includes("'wasm-unsafe-eval'"));
check('CSP no unsafe-eval token', !/script-src[^;]*'unsafe-eval'/.test(csp));
check('CSP MediaPipe model origin', csp.includes('https://storage.googleapis.com'));
if (supabaseUrl) {
  try {
    const origin = new URL(supabaseUrl).origin;
    check('CSP includes Supabase origin', csp.includes(origin), origin);
  } catch {
    check('CSP includes Supabase origin', false, 'invalid NEXT_PUBLIC_SUPABASE_URL');
  }
}
check('X-Frame-Options DENY', xfo === 'DENY');
check('X-Content-Type-Options nosniff', nosniff === 'nosniff');
check('Referrer-Policy', referrer === 'strict-origin-when-cross-origin');
check('Permissions-Policy camera self', permissions?.includes('camera=(self)') === true);

if (expectProduction) {
  check(
    'HSTS present (production)',
    hsts === 'max-age=31536000; includeSubDomains',
    hsts ?? 'missing',
  );
} else {
  check('HSTS absent (non-production expectation)', hsts === null, hsts ?? 'absent');
}

console.log(failed === 0 ? '\nAll security-header checks passed.' : `\n${failed} check(s) failed.`);
process.exit(failed === 0 ? 0 : 1);
