/**
 * Ensures MediaPipe assets are local under public/mediapipe/.
 *
 * - WASM: copied from the pinned @mediapipe/tasks-vision package (never CDN).
 * - Pose Landmarker .task: downloaded once from Google's documented URL into
 *   public/mediapipe/models so the kiosk browser never needs outbound GCS.
 *
 * public/mediapipe/ is gitignored; this script runs on `pnpm dev` / `pnpm build`.
 */

import {
  cpSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

/** Official Google-hosted lite float16 Pose Landmarker (build-time download only). */
export const MEDIAPIPE_POSE_MODEL_DOWNLOAD_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const packageDir = dirname(require.resolve('@mediapipe/tasks-vision'));
const wasmSource = resolve(packageDir, 'wasm');
const wasmDest = resolve(root, 'public', 'mediapipe', 'wasm');
const modelDest = resolve(root, 'public', 'mediapipe', 'models', 'pose_landmarker_lite.task');

/** Reject tiny/corrupt leftovers from a failed download. */
const MIN_MODEL_BYTES = 500_000;

if (!existsSync(wasmSource)) {
  throw new Error(`MediaPipe WASM not found at ${wasmSource}`);
}

mkdirSync(dirname(wasmDest), { recursive: true });
cpSync(wasmSource, wasmDest, { recursive: true });
console.log(`Copied MediaPipe WASM to ${wasmDest}`);

mkdirSync(dirname(modelDest), { recursive: true });
if (modelReady(modelDest)) {
  console.log(`Pose Landmarker model already present at ${modelDest}`);
} else {
  console.log(`Downloading Pose Landmarker model from Google storage…`);
  await downloadFile(MEDIAPIPE_POSE_MODEL_DOWNLOAD_URL, modelDest);
  if (!modelReady(modelDest)) {
    throw new Error(
      `Pose Landmarker download incomplete or too small at ${modelDest}. ` +
        'Check network access to storage.googleapis.com, then re-run.',
    );
  }
  console.log(`Wrote Pose Landmarker model to ${modelDest}`);
}

function modelReady(path) {
  try {
    return existsSync(path) && statSync(path).size >= MIN_MODEL_BYTES;
  } catch {
    return false;
  }
}

async function downloadFile(url, destPath) {
  const response = await fetch(url, {
    redirect: 'follow',
    headers: { accept: 'application/octet-stream,*/*' },
  });
  if (!response.ok || !response.body) {
    throw new Error(
      `Failed to download Pose Landmarker (${response.status} ${response.statusText})`,
    );
  }
  const tmp = `${destPath}.partial`;
  try {
    await pipeline(Readable.fromWeb(response.body), createWriteStream(tmp));
    renameSync(tmp, destPath);
  } catch (error) {
    try {
      unlinkSync(tmp);
    } catch {
      // Best-effort cleanup of a partial file.
    }
    throw error;
  }
}
