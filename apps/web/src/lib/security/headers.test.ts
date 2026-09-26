import { describe, expect, it } from 'vitest';

import { buildContentSecurityPolicy, buildSecurityHeaders } from './headers';

const SUPABASE = 'https://ptqqmlsdsgkpqygdsupq.supabase.co';

describe('security headers', () => {
  it('emits CSP with Supabase, MediaPipe, WASM, and camera-safe defaults in production', () => {
    const csp = buildContentSecurityPolicy({
      nodeEnv: 'production',
      supabaseUrl: SUPABASE,
    });

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'");
    // 'wasm-unsafe-eval' is required; bare 'unsafe-eval' must not appear as its own token.
    expect(csp).not.toMatch(/'unsafe-eval'/);
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).toContain(`img-src 'self' data: blob: ${SUPABASE}`);
    expect(csp).toContain(
      `connect-src 'self' ${SUPABASE} wss://ptqqmlsdsgkpqygdsupq.supabase.co https://storage.googleapis.com`,
    );
    expect(csp).toContain("worker-src 'self' blob:");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain('upgrade-insecure-requests');
  });

  it('includes HSTS and CSP only in production (dev omits CSP so Refresh eval is not Issues noise)', () => {
    const production = buildSecurityHeaders({
      nodeEnv: 'production',
      supabaseUrl: SUPABASE,
    });
    const development = buildSecurityHeaders({
      nodeEnv: 'development',
      supabaseUrl: SUPABASE,
    });

    const prodHsts = production.find((h) => h.key === 'Strict-Transport-Security');
    expect(prodHsts?.value).toBe('max-age=31536000; includeSubDomains');
    expect(production.find((h) => h.key === 'Content-Security-Policy')?.value).toContain(
      "frame-ancestors 'none'",
    );

    expect(development.find((h) => h.key === 'Strict-Transport-Security')).toBeUndefined();
    expect(development.find((h) => h.key === 'Content-Security-Policy')).toBeUndefined();
    expect(buildContentSecurityPolicy({ nodeEnv: 'development', supabaseUrl: SUPABASE })).not.toContain(
      'upgrade-insecure-requests',
    );
  });

  it('always sets clickjacking, MIME, referrer, and camera Permissions-Policy', () => {
    const headers = buildSecurityHeaders({
      nodeEnv: 'development',
      supabaseUrl: SUPABASE,
    });
    const map = Object.fromEntries(headers.map((h) => [h.key, h.value]));

    expect(map['X-Frame-Options']).toBe('DENY');
    expect(map['X-Content-Type-Options']).toBe('nosniff');
    expect(map['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(map['Permissions-Policy']).toBe('camera=(self), microphone=(), geolocation=()');
    expect(map['Content-Security-Policy']).toBeUndefined();
  });

  it('rejects non-https Supabase URLs so CSP cannot widen connect-src accidentally', () => {
    expect(() =>
      buildContentSecurityPolicy({
        nodeEnv: 'production',
        supabaseUrl: 'http://localhost:54321',
      }),
    ).toThrow(/https/);
  });

  it('documents why script-src includes unsafe-inline (Next Flight) but not unsafe-eval', () => {
    const production = buildSecurityHeaders({
      nodeEnv: 'production',
      supabaseUrl: SUPABASE,
    });
    const csp = production.find((h) => h.key === 'Content-Security-Policy')?.value ?? '';
    expect(csp).toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(csp).toMatch(/script-src[^;]*'wasm-unsafe-eval'/);
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-eval'/);
  });
});
