/**
 * Production security headers for the Next.js app.
 *
 * Kept as a pure module so Vitest can assert CSP/HSTS behaviour without
 * standing up a server. `next.config.ts` is the only runtime consumer.
 */

export type SecurityHeader = {
  readonly key: string;
  readonly value: string;
};

export type SecurityHeaderOptions = {
  /**
   * `process.env.NODE_ENV` at config evaluation time.
   * HSTS and `upgrade-insecure-requests` apply only when this is `production`.
   */
  readonly nodeEnv: string;
  /** Validated `NEXT_PUBLIC_SUPABASE_URL` origin (https://….supabase.co). */
  readonly supabaseUrl: string;
};

const MEDIAPIPE_MODEL_ORIGIN = 'https://storage.googleapis.com';

/**
 * Why `unsafe-inline` appears in script-src
 * ----------------------------------------
 * Next.js App Router / Flight embeds small inline `<script>` tags that seed
 * `self.__next_f` (verified on the production `index.html` output). Without a
 * nonce/hash pipeline in this repo, those scripts require `'unsafe-inline'`.
 *
 * `unsafe-eval` is intentionally absent: production chunks do not need it.
 * MediaPipe WASM compilation uses `'wasm-unsafe-eval'` instead.
 */
export function buildContentSecurityPolicy(options: SecurityHeaderOptions): string {
  const supabase = supabaseOrigins(options.supabaseUrl);
  const isProduction = options.nodeEnv === 'production';

  const directives: string[] = [
    "default-src 'self'",
    // Next Flight inline bootstrap + same-origin chunks + MediaPipe WASM.
    "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
    // React `style={{…}}`, Tailwind utilities, and QR SVG markup.
    "style-src 'self' 'unsafe-inline'",
    // Overlay decode may fall back to blob: object URLs; signed PNGs are fetched.
    `img-src 'self' data: blob: ${supabase.https}`,
    `connect-src 'self' ${supabase.https} ${supabase.wss} ${MEDIAPIPE_MODEL_ORIGIN}`,
    "font-src 'self'",
    "worker-src 'self' blob:",
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];

  if (isProduction) {
    directives.push('upgrade-insecure-requests');
  }

  return directives.join('; ');
}

/**
 * Physical LAN kiosk debugging uses `next dev`, which relies on eval for Fast
 * Refresh. Emitting CSP there floods Chrome Issues without improving
 * production safety. Production keeps a strict CSP (still no 'unsafe-eval').
 */
export function buildSecurityHeaders(options: SecurityHeaderOptions): SecurityHeader[] {
  const headers: SecurityHeader[] = [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    // Defence in depth alongside CSP frame-ancestors 'none'.
    { key: 'X-Frame-Options', value: 'DENY' },
    // Mirror needs camera; nothing else is granted.
    {
      key: 'Permissions-Policy',
      value: 'camera=(self), microphone=(), geolocation=()',
    },
  ];

  if (options.nodeEnv === 'production') {
    // CSP is production-only. Next.js / React Refresh in `next dev` uses
    // eval(); sending script-src without 'unsafe-eval' floods Chrome Issues
    // on LAN kiosk debugging. Production never needs eval — keep CSP strict
    // here (still no 'unsafe-eval').
    headers.unshift({
      key: 'Content-Security-Policy',
      value: buildContentSecurityPolicy(options),
    });
    headers.push({
      key: 'Strict-Transport-Security',
      // One year. No preload — that is a public-list commitment this repo
      // does not make on behalf of an operator's domain.
      value: 'max-age=31536000; includeSubDomains',
    });
  }

  return headers;
}

function supabaseOrigins(supabaseUrl: string): { https: string; wss: string } {
  let parsed: URL;
  try {
    parsed = new URL(supabaseUrl);
  } catch {
    throw new Error('Security headers require a valid NEXT_PUBLIC_SUPABASE_URL');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL must be https for CSP connect-src');
  }
  return {
    https: parsed.origin,
    wss: `wss://${parsed.host}`,
  };
}
