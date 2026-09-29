# Production deployment runbook

Concise operator guide for shipping MirrorFit AI as this repository exists today.
It does **not** invent Docker, Kubernetes, or a cloud PaaS — production is a
Node process serving the Next.js app (`pnpm start`) behind **your** HTTPS
terminator, plus the linked Supabase project.

## Local development HTTPS vs production TLS

| | Local kiosk verification | Production |
| --- | --- | --- |
| Certificate | MirrorFit **local CA** + SAN cert from `apps/web/scripts/ensure-dev-certs.mjs` | Real certificate from a public CA (or your org PKI) on a reverse proxy / platform |
| How to start | `pnpm dev` (HTTPS via `scripts/dev.mjs`) | `pnpm build` then `pnpm start` behind TLS |
| Trust | Install the local CA on the phone (`/dev-ca`, HTTP on the LAN) so Safari trusts the kiosk origin | Browsers already trust public CAs; **do not** ship or install the local CA in production |
| HSTS | **Not** sent (`NODE_ENV=development`) | Sent by the Next app when `NODE_ENV=production` |

Never treat the local CA as production TLS.

## Required environment variables (names only)

Copy `.env.example` → `apps/web/.env.local` (Next reads env from `apps/web`, not the repo root).

**Public (browser-inlined):**

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

**Server only (`server-only`):**

- `SUPABASE_SECRET_KEY`

CI uses placeholder public values for build only. Real production values come from your secret store — never commit them.

## Supabase migrations

- SQL lives in `supabase/migrations/`.
- Linked project id is documented in `supabase/config.toml` / README (`mirrorfit-ai`).
- Apply with the Supabase CLI against the linked project (e.g. `supabase db push` / dashboard migration apply). Prefer reviewing each migration before apply.
- After schema changes, regenerate types:

```bash
supabase gen types typescript --project-id <project-ref> \
  > apps/web/src/lib/supabase/database.types.ts
```

- Forward-only migrations: do not edit already-applied files; add a new migration to correct.

## Storage

Production garment overlays use the private `garment-assets` Storage bucket (see migration `*_garment_assets_storage_bucket.sql`). Overlays leave the server only as short-lived **service-role signed URLs** after device auth — never as public objects.

Optional realistic try-on stills use a separate private `tryon-private` bucket (`*_tryon_private_bucket.sql`). Apply that migration before enabling the worker. The browser never receives the bucket path. `WORKER_SECRET` (16+ characters) and `WORKER_ENDPOINT_URL` are optional and are not part of the client bundle. `RUNPOD_ENDPOINT_URL` is a legacy alias for the same private URL. If the endpoint is unset the provider stays **not connected** and jobs fail with `VTON_NOT_CONNECTED` instead of a fake image. See `docs/vton-pre-gpu.md`. Run `pnpm --filter @mirrorfit/web tryon-worker` on the GPU machine (RTX 4090 24GB is enough for current still-image VTON; no public GPU port). The mirror does not call the GPU.

## MediaPipe assets

`pnpm build` / `pnpm dev` run `apps/web/scripts/copy-mediapipe-wasm.mjs`, which:

1. Copies `@mediapipe/tasks-vision` WASM into `apps/web/public/mediapipe/wasm`.
2. Downloads the official Pose Landmarker `.task` once into
   `apps/web/public/mediapipe/models/pose_landmarker_lite.task` (gitignored).

The **browser loads the model same-origin** — it does not call
`storage.googleapis.com` at runtime. Build/dev machines need outbound HTTPS to
Google storage on first install (or after deleting `public/mediapipe/`). Offline
kiosk browsers are fine once the model is on disk.

## Local kiosk recover (Turbopack / IP drift)

If `https://<lan>:3111/mirror` listens but never responds, or the phone HTTPS
SAN no longer matches after a hotspot/Wi-Fi change:

```bash
pnpm --filter @mirrorfit/web kiosk-recover
# force SAN cert rebuild even if hosts.json still matches:
pnpm --filter @mirrorfit/web kiosk-recover -- --force-certs
pnpm --filter @mirrorfit/web dev
```

`kiosk-recover` deletes `apps/web/.next/dev` (and `.next/cache`), regenerates
the LAN HTTPS certificate when interfaces changed, and prints the SAN hosts.
Prefer cloning the repo **outside OneDrive** on the permanent kiosk PC — synced
folders have corrupted Turbopack’s pack database on Windows.

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm start
```

- Build script: `@mirrorfit/web` → `copy-mediapipe-wasm` + `next build`.
- Start script: `next start` (default port **3000** unless `PORT` is set by your host).
- Terminate TLS **in front of** Node (reverse proxy / load balancer). The app emits HSTS when running as production Node (`NODE_ENV=production`); the edge must still serve HTTPS.

## Domain / origin requirements

- Staff UI, `/mirror`, and `/s` must be served from the **same HTTPS origin** customers and kiosks will use.
- Pairing QR encodes `/s?t=…` on the origin the kiosk opened — spoofed Host headers must not be trusted for minting (server uses the request URL the kiosk actually hit).
- Point `NEXT_PUBLIC_SUPABASE_URL` at the real project; CSP `connect-src` / `img-src` are derived from that origin at build time.

## First tenant

There is no public “sign up” for organizations. Provision with:

```bash
pnpm --filter @mirrorfit/web provision-tenant -- …
```

(see `apps/web/scripts/provision-tenant.mjs`). Change the printed password after first login.

## Health / liveness

```bash
curl -sS https://<host>/api/health
```

Expect JSON `{ "status": "ok", "protocol_version": … }`. The route deliberately omits configuration and secret presence.

## Smoke tests

With production env and a running server:

```bash
pnpm --filter @mirrorfit/web e2e
```

(`apps/web/scripts/e2e-phase3.mjs`, uses `E2E_BASE_URL` when set). Unit suite: `pnpm test`. Full gate: `pnpm verify`.

## Security headers — how to verify

Against a **production** `next start` (or your HTTPS front door):

```bash
curl -sSI https://<host>/ | findstr /I "content-security-policy strict-transport-security x-frame-options"
```

Expect:

- `Content-Security-Policy` including `frame-ancestors 'none'`, Supabase origin, `storage.googleapis.com`, `'wasm-unsafe-eval'`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy` with `camera=(self)`

Against **local `pnpm dev`**, HSTS must **not** appear.

Automated coverage: `apps/web/src/lib/security/headers.test.ts`.

## Verify `/mirror`

1. Open `https://<host>/mirror` on the kiosk browser (public path — no staff login).
2. Enroll with a staff-issued code from `/displays`.
3. Confirm camera permission, heartbeat, and QR attract screen.

## Verify `/s`

1. From a live WAITING session, scan the on-glass QR (or open the pairing URL).
2. Phone should load `/s?t=…` without being redirected to `/login`.
3. Claim → browse catalog → select garment; mirror should show overlay try-on (pose + PNG overlay — not photorealistic try-on).

## Revoke / re-enroll a mirror

1. Staff admin on `/displays`: revoke the device credential.
2. Display status becomes `REVOKED`; revoked secret returns **401** on device APIs.
3. Issue a new enrollment code; on the kiosk, enroll again. Prior credentials are revoked; display returns to enrolled/`ONLINE`.

## End a stuck session

- Prefer the kiosk **End** control (calls `/api/session/end`).
- Stale WAITING/PAIRED (pairing window) and idle ACTIVE sessions are swept by `expire_stale_sessions` (scheduled via `pg_cron` when that migration is applied).
- Do not invent manual SQL unless you know the session tenancy model.

## Recover after browser / device restart

1. Re-open the same HTTPS `/mirror` URL (kiosk browser, preferably kiosk/fullscreen mode).
2. Device secret is restored from local persistence (`localStorage` key managed by the device store) — re-enrollment is **not** required unless the credential was revoked or storage cleared.
3. If storage was cleared or credential revoked: use a fresh enrollment code.

## Rollback

1. **App:** redeploy the previous known-good build artifact / git revision; run `pnpm build && pnpm start` (or your host’s equivalent). Keep the same env var **names**; rotate secrets only if compromised.
2. **Database:** Supabase migrations are not automatically reversible. Prefer a new forward migration to undo behaviour. For disaster recovery use Supabase project backups / PITR (dashboard) — restore is a platform operation, not a script in this repo.
3. **Storage:** bucket policies live in migrations; rolling back app code without matching storage/RLS state can break overlay loads.

## Database backup / restore

- Use the Supabase project’s backup / point-in-time recovery features for the linked project.
- After a restore, confirm migrations match the restored schema and re-run smoke tests.
- Never paste service-role keys, pairing tokens, or signed URLs into tickets or chat.

## What this repo does not provide

- Docker/Kubernetes manifests
- Cloud-specific deploy pipelines beyond GitHub Actions CI (`pnpm verify` on PRs)
- Automatic TLS certificate issuance (that is your reverse proxy / platform)
