/**
 * Copies official @mediapipe/tasks-vision WASM into public/ so the kiosk
 * does not load WASM from an unpinned CDN. The Pose Landmarker .task model
 * still loads from Google's documented storage.googleapis.com URL at runtime.
 */

import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const packageDir = dirname(require.resolve('@mediapipe/tasks-vision'));
const source = resolve(packageDir, 'wasm');
const dest = resolve(root, 'public', 'mediapipe', 'wasm');

if (!existsSync(source)) {
  throw new Error(`MediaPipe WASM not found at ${source}`);
}

mkdirSync(dirname(dest), { recursive: true });
cpSync(source, dest, { recursive: true });
console.log(`Copied MediaPipe WASM to ${dest}`);
