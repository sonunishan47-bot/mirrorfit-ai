/**
 * GPU worker process. The browser never calls the GPU.
 *
 * Inference lives in vton-worker-loop.ts (generateStill). If no
 * WORKER_ENDPOINT_URL is configured, a claimed job is completed FAILED with
 * VTON_NOT_CONNECTED. This file does not paint an image.
 *
 * Set WORKER_ENDPOINT_URL to a private model server (RunPod localhost or your
 * own GPU). RUNPOD_ENDPOINT_URL is only a legacy alias. No public GPU port.
 */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('./tryon-ts-resolve.mjs', import.meta.url);

const { runVtonWorker } = await import('../src/lib/tryon/vton-worker-loop.ts');

let stopped = false;
process.on('SIGINT', () => {
  stopped = true;
});
process.on('SIGTERM', () => {
  stopped = true;
});

await runVtonWorker({ shouldStop: () => stopped });
