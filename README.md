# MirrorFit AI

B2B retail smart mirror platform. A customer scans a QR code on an in-store
mirror, browses the shop catalog from their own phone, and sees the selected
garment rendered live on the mirror display.

**Current state: Phase 1 (foundation).** The monorepo, shared packages and
Supabase wiring exist. The kiosk, catalog, pairing flow and fitting pipeline
do not.

## Layout

```
apps/web              Next.js App Router application
packages/types        Domain vocabulary. No runtime dependencies.
packages/validation   Shared Zod primitives and enum schemas.
packages/protocol     Realtime wire protocol and transport abstraction.
packages/tryon-core   Vision pipeline interfaces and performance measurement.
packages/ui           Design tokens and shared UI utilities.
supabase/migrations   Database migrations (empty until Phase 2).
```

Packages ship TypeScript source and are compiled by Next through
`transpilePackages`, so there is no package build step in the inner loop.

## Prerequisites

- Node 20.11 or newer (22 recommended; see `.nvmrc`)
- pnpm 9.15.4

If `corepack enable` fails with a permissions error on Windows, install pnpm
directly instead: `npm install -g pnpm@9.15.4`.

## Setup

```bash
pnpm install
cp .env.example apps/web/.env.local   # then fill in the values
pnpm dev
```

Next.js reads environment files from `apps/web`, not the repository root. The
root `.env.example` is the canonical template for every variable the system
uses.

`SUPABASE_SECRET_KEY` is not populated automatically. Copy it from the
Supabase dashboard under Project Settings then API Keys. It bypasses row level
security; treat it like a root password.

## Scripts

| Command            | Purpose                                     |
| ------------------ | ------------------------------------------- |
| `pnpm dev`         | Run the web app in development              |
| `pnpm build`       | Production build                            |
| `pnpm lint`        | ESLint across the workspace                 |
| `pnpm typecheck`   | `tsc --noEmit` in every package             |
| `pnpm test`        | Vitest unit tests                           |
| `pnpm format`      | Apply Prettier                              |

CI runs format check, lint, typecheck, test and build on every pull request.

## Environment separation

Two tiers, enforced in code rather than by convention:

- `apps/web/src/env/client.ts` validates `NEXT_PUBLIC_*` only. Everything it
  reads is inlined into the browser bundle.
- `apps/web/src/env/server.ts` validates secrets and imports `server-only`,
  which makes reaching it from a client component a build error.

## Supabase

Linked project: `mirrorfit-ai` (`ptqqmlsdsgkpqygdsupq`), region `ap-south-1`,
chosen for latency to Gulf retail installations. Realtime round-trip time
between the mirror and the customer phone is the constraint that drives this
choice.

Regenerate database types after every migration:

```bash
supabase gen types typescript --project-id ptqqmlsdsgkpqygdsupq \
  > apps/web/src/lib/supabase/database.types.ts
```

## Performance

Targets, measured rather than asserted:

- 30 FPS minimum for live fitting, 60 FPS on capable hardware
- p95 garment-selection-to-visible around 250 ms when the asset is cached

`PerformanceRegistry`, `RollingWindow` and `FrameRateCounter` in
`@mirrorfit/tryon-core` record real samples. A metric with no samples reports
`null`, never `0`, so an unmeasured stage cannot be mistaken for a fast one.

## Roadmap

Phase 2 database schema and RLS, then device registration, kiosk shell, vision
baseline, asset pipeline, QR pairing, customer catalog, live fitting, AI
recommendations, size recommendation, staff requests, dashboard, offline cache,
hardening, deployment.
