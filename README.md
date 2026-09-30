# MirrorFit AI

B2B retail smart mirror platform. A customer scans a QR code on an in-store
mirror, browses the shop catalog from their own phone, and sees the selected
garment rendered live on the mirror display.

**This is not a Phase 1 scaffold.** The old README line that the repo was
“Phase 1 only” and that the kiosk was not implemented is obsolete. Pairing,
the shop mirror, the phone catalog, staff catalog, and live pose fitting are
in this repository.

**Current state.** The shop mirror pairs by QR, the phone browses that shop’s catalog, and shirts and pants track locally with MediaPipe. Dress, abaya, kurta, churidar, and thobe track as a labelled pose silhouette — not the shirt warp, and not a photo. A consented still can be sent to a private GPU worker (`WORKER_ENDPOINT_URL`) without a fake image. Size advice, a 3D mannequin, bilingual catalog commands, and plan quotas are in the app. They do not replace the live camera path, and they do not call a language model or a VTON checkpoint unless you connect one.

## Layout

```
apps/web              Next.js App Router application
packages/types        Domain vocabulary. No runtime dependencies.
packages/validation   Shared Zod primitives and enum schemas.
packages/protocol     Realtime wire protocol and transport abstraction.
packages/tryon-core   Vision pipeline interfaces and performance measurement.
packages/ui           Design tokens and shared UI utilities.
supabase/migrations   Applied schema: tenancy, devices, catalog, sessions, try-on jobs, storage.
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

## Operations

- [Production deployment runbook](docs/production-deployment.md) — env names, migrations, TLS vs local CA, headers, rollback
- [Kiosk operator runbook](docs/kiosk-runbook.md) — enroll, pair, recover, privacy

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

## Try-on

- **Shirt and pants:** live pose warp of an overlay on the mirror. Not a photograph.
- **Dress, abaya, kurta, churidar, thobe:** recognised. A pose silhouette tracks the shoulders to the hem. It is not the shirt warp and not a photograph. An uploaded overlay image, if the shop has one, is placed on that same hem.
- **Photorealistic still:** the mirror asks for consent, holds for three seconds, then `POST /api/device/tryon-jobs` stores one JPEG. The worker claims `/api/worker/tryon-jobs/claim` and completes `/api/worker/tryon-jobs/complete`. The shop model is FASHN (`MODEL_NAME=fashn`, `services/still-vton`). It keeps the captured face and can place a plain studio plate behind the person. Point it at `WORKER_ENDPOINT_URL`. `RUNPOD_ENDPOINT_URL` is only a legacy alias for that same URL. If the URL or the weights are unset the job fails and the live overlay stays. The app does not draw a fake result. It is not a live video.
- **Catalog:** staff add garments at `/catalog` after signing in. The seed script is only for the labelled trial shirt and pants. Fabric, fit, and an extra line on that form are stored on the garment for the delayed clip below. They are not shown as a second catalog.

## Store delayed try-on (Lucy Edit Dev)

This is optional and off until `LUCY_EDIT_DEV=1`. It does not replace the live pose overlay or the FASHN still. It does not call Decart, and it does not add a checkout.

**License.** Lucy Edit Dev weights are non-commercial. Do not charge for this path. The flag does not make the weights commercial.

**What the customer sees.** The mirror keeps the live camera. The phone catalog is unchanged and does not receive the clip or a body image. When a garment is selected, the mirror keeps the last valid webcam segment (12 seconds, restarted so the file stays playable) and sends the last 6 seconds to ComfyUI on this computer. One GPU job runs at a time. A third tap while one is running and one is waiting is refused. The result plays on the mirror, then the live preview returns. If ComfyUI is down, the live preview stays. Nothing is invented.

**Prompt.** `Change the outfit to a {color} {garment}, {fabric_and_details}, {fit}, natural folds and drape, realistic studio lighting, full-body mid-shot.` An optional extra line is appended. The prompt does not say to preserve a face.

**Install, on the shop PC.**

1. ComfyUI, plus [DecartAI/lucy-edit-comfyui](https://github.com/DecartAI/lucy-edit-comfyui), [ComfyUI-VideoHelperSuite](https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite) (`VHS_LoadVideoFFmpeg`), and [ComfyUI-KJNodes](https://github.com/kijai/ComfyUI-KJNodes) (`ImageResizeKJv2`).
2. Weights, not stored in this repo:
   - `ComfyUI/models/diffusion_models/lucy-edit-1.1-dev-cui-fp16.safetensors`
   - `ComfyUI/models/vae/wan2.2_vae.safetensors`
   - `ComfyUI/models/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors` (CLIP type `wan`)
3. Start ComfyUI on `127.0.0.1:8188`. On an 8GB card, start it with `--lowvram`.
4. In `apps/web/.env.local` set `LUCY_EDIT_DEV=1`. Optional: `COMFYUI_URL`, `LUCY_VRAM_PROFILE`, `LUCY_UNET_NAME`.
5. Start MirrorFit with `pnpm dev` (or the production server). The phone uses the same host as the mirror QR: `/s?t=…` on the shop LAN. The clip itself stays on the mirror.

**VRAM profiles.** Heights are multiples of 32 because the Lucy graph requires it. `640x360` is sent as `640x352`. `720p` is sent as `1280x704`.

| Profile | Input | FPS | Frames | Steps |
| --- | --- | --- | --- | --- |
| `gpu_8gb` | 640×480 | 12 | 17 | 8 |
| `gpu_12gb` (default) | 640×352 | 16 | 25 | 10 |
| `gpu_16gb_plus` | 1280×704 | 16 | 33 | 12 |

Shop cards will not match a hosted per-second model. These frame counts are the local budget, not a 30fps claim. The route waits up to two minutes and then leaves the live preview in place.

## Roadmap

The Phase 1-only roadmap is retired. Shipped here: tenancy, device enrollment, QR pairing, phone catalog, staff catalog at `/catalog`, live pose fitting, full-body silhouettes, trial shirt and pants, consented still jobs, a GPU worker boundary, size advice, a 3D mannequin, shop operations, and an optional local Lucy clip path. Still not connected until the shop installs them: FASHN weights for the still worker, and Lucy Edit Dev weights in ComfyUI. That is a machine and a licence, not another app rewrite. The app does not draw a fake photograph or a fake clip while those are unset.

