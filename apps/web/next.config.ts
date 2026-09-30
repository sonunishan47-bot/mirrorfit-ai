import type { NextConfig } from 'next';

import { ALLOWED_DEV_ORIGINS } from './src/lib/dev/allowed-dev-origins';
import { buildSecurityHeaders } from './src/lib/security/headers';

/**
 * Workspace packages ship TypeScript source rather than build output, so Next
 * compiles them alongside the app. This removes a build-ordering step from the
 * monorepo; if package build times ever become the bottleneck, this is the
 * decision to revisit.
 */
const workspacePackages = [
  '@mirrorfit/types',
  '@mirrorfit/validation',
  '@mirrorfit/protocol',
  '@mirrorfit/tryon-core',
  '@mirrorfit/experience',
  '@mirrorfit/ui',
];

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (!supabaseUrl) {
  throw new Error(
    'NEXT_PUBLIC_SUPABASE_URL is required to build CSP connect-src / img-src. ' +
      'Copy .env.example to apps/web/.env.local (or set CI placeholders).',
  );
}

const securityHeaders = buildSecurityHeaders({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  supabaseUrl,
});

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: workspacePackages,
  serverExternalPackages: ['@mediapipe/tasks-vision'],
  typedRoutes: true,
  allowedDevOrigins: [...ALLOWED_DEV_ORIGINS],
  experimental: {
    // The proxy default is 10MB. A 12s mirror segment can be larger than that.
    proxyClientMaxBodySize: '16mb',
  },
  /*
   * Next writes AGENTS.md and CLAUDE.md on every dev run. This repository
   * keeps its own guidance in .cursor/rules, and a file the framework
   * rewrites on each start is exactly what broke `format:check` once already.
   */
  agentRules: false,
  headers: () =>
    Promise.resolve([
      {
        source: '/:path*',
        headers: securityHeaders.map((h) => ({ key: h.key, value: h.value })),
      },
    ]),
};

export default nextConfig;
