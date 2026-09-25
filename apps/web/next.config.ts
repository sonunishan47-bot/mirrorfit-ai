import type { NextConfig } from 'next';

import { ALLOWED_DEV_ORIGINS } from './src/lib/dev/allowed-dev-origins';

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
  '@mirrorfit/ui',
];

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Neither the kiosk nor the customer phone UI is ever embedded.
  { key: 'X-Frame-Options', value: 'DENY' },
  // The mirror needs the camera; nothing else is granted.
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: workspacePackages,
  typedRoutes: true,
  /*
   * Dev only. Without this, a kiosk opened at the advertised Network URL
   * (http://172.x.x.x:port/mirror) renders SSR HTML but never hydrates:
   * Next 16 answers Origin-bearing /_next requests with 403 Unauthorized.
   */
  allowedDevOrigins: [...ALLOWED_DEV_ORIGINS],
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
        headers: securityHeaders,
      },
    ]),
};

export default nextConfig;
