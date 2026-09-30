# Pre-GPU photorealistic try-on

The mirror is ready to call a real model. No model is bundled, and none was executed in this repository.

## What already runs without a GPU

- Laptop, webcam, and kiosk cameras stay local. MediaPipe and the 2D shirt/pant overlay do not wait on VTON.
- One consented JPEG (about 1280px, quality 0.85) can be stored in the private `tryon-private` bucket.
- `tryon_jobs` moves QUEUED → RUNNING → SUCCEEDED, or FAILED / CANCELLED. A late SUCCEEDED is stored as `SESSION_ENDED` or `STALE_SELECTION` instead.
- The phone catalog never receives the still, the output, or an `AI_REFERENCE` path.

Apply `supabase/migrations/20260929120000_tryon_private_bucket.sql` before the first upload. Without that bucket, create-job returns an error and the 2D overlay remains.

## Worker contract

Run `pnpm --filter @mirrorfit/web tryon-worker` on the GPU machine. The process needs Node.js 22.18 or newer and loads the TypeScript worker directly. It does not download weights and it does not open a public port.

| Variable | Role |
| --- | --- |
| `MIRRORFIT_APP_ORIGIN` | Public app the worker polls |
| `WORKER_SECRET` | Bearer shared with the app. 16+ characters |
| `WORKER_ENDPOINT_URL` | Private model server. `RUNPOD_ENDPOINT_URL` is a legacy alias |
| `MODEL_PROVIDER` / `MODEL_NAME` / `MODEL_VERSION` | Capability profile. Not a secret |
| `MODEL_ALLOW_NONCOMMERCIAL` | Set to `1` only for a private research trial |

The model server accepts:

```json
{
  "job_id": "...",
  "mode": "still",
  "person_url": "...",
  "garment_url": "...",
  "garment_category": "Shirt",
  "fit_category": "TOP",
  "model": { "provider": "private", "name": null, "version": null }
}
```

`200` with `image/jpeg` completes the job. Anything else fails. `mode` is `still` until a future capture path exists. `videoCapable` on a profile does not make the mirror upload video.

`GET /health` on the endpoint origin is probed at startup. A failed probe does not invent an image; inference is still attempted only when an endpoint is set.

## Open-source checkpoints (not installed)

Checked against project licenses in September 2026. These are capability gates only.

| Profile | Still categories | Video flag | Shop use |
| --- | --- | --- | --- |
| `catvton` | top, lower, full | no | blocked, CC BY-NC-SA 4.0 |
| `idm-vton` | top only | no | blocked, CC BY-NC-SA 4.0 |
| `ootdiffusion` | top, full | no | blocked, CC BY-NC-SA 4.0 |
| `catv2ton` | top, lower, full | yes | blocked, CC BY-NC-SA 4.0 |
| `qwen-image-2.1` | top, lower, full | no | blocked, research license |
| `fashn` | top, lower, full | no | allowed, Apache-2.0 stills |

An unknown `MODEL_NAME` is treated as your own private server: all three fit families, still mode, license unknown. Full-body garments (churidar, dress, abaya, kurta, thobe) are not warped in 2D. If the selected profile does not list that family, the job fails `CATEGORY_UNSUPPORTED`.

RTX 4090 24GB is the practical still-image card for this class of model. FASHN VTON v1.5 also runs on a 16GB card. Do not publish a GPU port. Swap RunPod for your own machine by changing `WORKER_ENDPOINT_URL` only.

Shop still server (no weights in git):

```bash
cd services/still-vton
pip install pillow
# then install fashn-vton and download model.safetensors into ./weights
FASHN_WEIGHTS_DIR=./weights python server.py
```

Set `MODEL_NAME=fashn` and `WORKER_ENDPOINT_URL=http://127.0.0.1:8090/infer` on the Node worker. The server binds to localhost. It copies the captured face back onto the result and, when the shop wall can be separated, places the person on a plain studio gradient. If the weights are missing it returns 503 and no JPEG.
