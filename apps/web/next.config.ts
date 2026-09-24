import type { NextConfig } from 'next';

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
  headers: () =>
    Promise.resolve([
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ]),
};

export default nextConfig;
