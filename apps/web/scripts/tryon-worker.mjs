/**
 * Optional photorealistic worker. Run this ON the GPU pod, not in the browser.
 *
 * The mirror posts one JPEG to the app. This process polls with WORKER_SECRET,
 * then calls a private inference URL. The browser never calls RunPod.
 *
 * Preferred pod: RTX 4090 24GB Community, EU-SE or EU-RO, a network volume for
 * weights, no public GPU port. Stop the pod when the shop is closed.
 *
 * If RUNPOD_ENDPOINT_URL is unset, a claimed job is completed FAILED with
 * VTON_NOT_CONNECTED. This script does not invent an image.
 *
 * Endpoint contract (your model server, typically http://127.0.0.1 on the pod):
 *   POST application/json { person_url, garment_url, job_id }
 *   200 image/jpeg
 * Weights are not vendored here. CatVTON / IDM-VTON class checkpoints are often
 * non-commercial — do not treat a missing checkpoint as a successful try-on.
 */

const origin = (process.env.MIRRORFIT_APP_ORIGIN ?? '').replace(/\/$/, '');
const secret = (process.env.WORKER_SECRET ?? '').trim();
const endpoint = (process.env.RUNPOD_ENDPOINT_URL ?? '').trim();

if (!origin || secret.length < 16) {
  console.error('MIRRORFIT_APP_ORIGIN and WORKER_SECRET (16+ chars) are required.');
  process.exit(1);
}

let stopped = false;
process.on('SIGINT', () => {
  stopped = true;
});
process.on('SIGTERM', () => {
  stopped = true;
});

while (!stopped) {
  try {
    const claimed = await claim();
    if (!claimed) {
      await sleep(2000);
      continue;
    }
    if (!endpoint.startsWith('http://') && !endpoint.startsWith('https://')) {
      await complete(claimed.job_id, 'FAILED', 'VTON_NOT_CONNECTED', null);
      continue;
    }
    if (!claimed.garment_reference_url) {
      await complete(claimed.job_id, 'FAILED', 'GARMENT_REFERENCE_MISSING', null);
      continue;
    }
    const jpeg = await infer(claimed);
    if (!jpeg) {
      await complete(claimed.job_id, 'FAILED', 'VTON_UPSTREAM', null);
      continue;
    }
    await complete(claimed.job_id, 'SUCCEEDED', null, jpeg);
  } catch (error) {
    console.error(error instanceof Error ? error.message.slice(0, 200) : 'worker loop failed');
    await sleep(2000);
  }
}

async function claim() {
  const response = await fetch(`${origin}/api/worker/tryon-jobs/claim`, {
    method: 'POST',
    headers: { authorization: `Bearer ${secret}` },
  });
  if (!response.ok) return null;
  const body = await response.json();
  if (!body?.job?.job_id || !body.job.input_url) return null;
  return body.job;
}

async function infer(job) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'image/jpeg' },
    body: JSON.stringify({
      person_url: job.input_url,
      garment_url: job.garment_reference_url,
      job_id: job.job_id,
    }),
    signal: AbortSignal.timeout(18_000),
  });
  const type = response.headers.get('content-type') ?? '';
  if (!response.ok || !type.includes('image/jpeg')) return null;
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength < 3 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff)
    return null;
  return bytes;
}

async function complete(jobId, status, errorCode, jpeg) {
  const form = new FormData();
  form.set('job_id', jobId);
  form.set('status', status);
  if (errorCode) form.set('error_code', errorCode);
  if (jpeg) form.set('image', new Blob([jpeg], { type: 'image/jpeg' }), 'out.jpg');
  const response = await fetch(`${origin}/api/worker/tryon-jobs/complete`, {
    method: 'POST',
    headers: { authorization: `Bearer ${secret}` },
    body: form,
  });
  if (!response.ok) {
    console.error(`complete ${status} rejected`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
