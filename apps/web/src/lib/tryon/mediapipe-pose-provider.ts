import {
  poseFrameFromMediaPipe,
  UnavailablePoseProvider,
  type CameraFrame,
  type PoseFrame,
  type PoseProvider,
} from '@mirrorfit/tryon-core';

/**
 * Official MediaPipe Pose Landmarker (lite, float16).
 *
 * WASM: copied from @mediapipe/tasks-vision into /mediapipe/wasm
 * Model: vendored at build/dev into /mediapipe/models (see copy-mediapipe-wasm.mjs).
 * The Google storage URL is the download source for that script only — the
 * browser does not fetch GCS at runtime (offline / filtered Wi-Fi safe).
 *
 * Apache-2.0 runtime. Client-only. Frames never leave this process.
 *
 * Worker / OffscreenCanvas: not used. The lite model at a capped 8 FPS is
 * intended to share the main thread with the camera preview. A worker would
 * add transferable-frame complexity without a measured main-thread stall.
 */

/** Same-origin path served from public/mediapipe/models after ensure script. */
export const MEDIAPIPE_POSE_MODEL_PATH = '/mediapipe/models/pose_landmarker_lite.task';

/**
 * Official download URL used by `scripts/copy-mediapipe-wasm.mjs`.
 * Kept here so privacy tests can assert we still pin Google's documented object
 * and do not invent a third-party CDN.
 */
export const MEDIAPIPE_POSE_MODEL_DOWNLOAD_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

/** @deprecated Use MEDIAPIPE_POSE_MODEL_PATH — runtime no longer loads GCS. */
export const MEDIAPIPE_POSE_MODEL_URL = MEDIAPIPE_POSE_MODEL_PATH;

export const MEDIAPIPE_WASM_PATH = '/mediapipe/wasm';

const LOCAL_MODEL_MISSING =
  'Pose model missing under /mediapipe/models. Run pnpm --filter @mirrorfit/web dev (or build) so copy-mediapipe-wasm.mjs can install it.';

type PoseLandmarkerLike = {
  detectForVideo(
    source: HTMLVideoElement,
    timestampMs: number,
  ): { landmarks?: Array<Array<{ x: number; y: number; z?: number; visibility?: number }>> };
  close(): void;
};

export class MediaPipePoseProvider implements PoseProvider {
  readonly name = 'mediapipe-pose-landmarker-lite';
  #availability: 'ready' | 'unavailable' | 'initializing' = 'unavailable';
  #lastError: string | null = null;
  #landmarker: PoseLandmarkerLike | null = null;
  #lastTimestamp = -1;
  /** Bumped on every initialize/dispose so a late create cannot orphan WASM. */
  #epoch = 0;

  get availability(): 'ready' | 'unavailable' | 'initializing' {
    return this.#availability;
  }

  get lastError(): string | null {
    return this.#lastError;
  }

  async initialize(): Promise<void> {
    await this.dispose();
    const epoch = ++this.#epoch;
    this.#availability = 'initializing';
    this.#lastError = null;

    if (typeof window === 'undefined') {
      this.#fail('Pose Landmarker requires a browser window.');
      return;
    }
    if (typeof WebAssembly !== 'object') {
      this.#fail('WebAssembly is not available in this browser.');
      return;
    }

    try {
      const modelOk = await probeLocalPoseModel(MEDIAPIPE_POSE_MODEL_PATH);
      if (epoch !== this.#epoch) return;
      if (!modelOk) {
        this.#fail(LOCAL_MODEL_MISSING);
        return;
      }

      const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision');
      const fileset = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_PATH);
      const landmarker = (await PoseLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: MEDIAPIPE_POSE_MODEL_PATH,
        },
        runningMode: 'VIDEO',
        numPoses: 1,
      })) as PoseLandmarkerLike;

      if (epoch !== this.#epoch) {
        try {
          landmarker.close();
        } catch {
          // Already torn down or superseded by a newer initialize/dispose.
        }
        return;
      }

      this.#landmarker = landmarker;
      this.#availability = 'ready';
    } catch (error) {
      if (epoch !== this.#epoch) return;
      this.#fail(reasonFrom(error));
    }
  }

  async estimate(frame: CameraFrame): Promise<PoseFrame | null> {
    return this.processFrame(frame);
  }

  processFrame(frame: CameraFrame): Promise<PoseFrame | null> {
    if (this.#availability !== 'ready' || !this.#landmarker) return Promise.resolve(null);
    const source = frame.source;
    if (!(source instanceof HTMLVideoElement)) return Promise.resolve(null);
    if (source.videoWidth === 0 || source.videoHeight === 0) return Promise.resolve(null);

    let timestamp = frame.timestampMs;
    if (timestamp <= this.#lastTimestamp) {
      timestamp = this.#lastTimestamp + 1;
    }
    this.#lastTimestamp = timestamp;

    try {
      // `source` is the live kiosk <video>. Coordinates stay in video space;
      // the overlay canvas is CSS-mirrored with the preview, not here.
      const result = this.#landmarker.detectForVideo(source, timestamp);
      // Guard empty/partial MediaPipe results (see firstPersonLandmarks).
      const person = firstPersonLandmarks(result);
      return Promise.resolve(poseFrameFromMediaPipe(person ?? undefined, frame.timestampMs));
    } catch (error) {
      this.#lastError = reasonFrom(error);
      return Promise.resolve(null);
    }
  }

  dispose(): Promise<void> {
    this.#epoch += 1;
    const landmarker = this.#landmarker;
    this.#landmarker = null;
    this.#availability = 'unavailable';
    this.#lastTimestamp = -1;
    try {
      landmarker?.close();
    } catch {
      // close() can throw if the WASM runtime is already torn down.
    }
    return Promise.resolve();
  }

  #fail(message: string): void {
    this.#availability = 'unavailable';
    this.#lastError = message;
    this.#landmarker = null;
  }
}

export async function createKioskPoseProvider(): Promise<PoseProvider> {
  const provider = new MediaPipePoseProvider();
  await provider.initialize();
  if (provider.availability === 'ready') {
    return provider;
  }
  return new UnavailablePoseProvider(
    provider.lastError ?? 'MediaPipe Pose Landmarker failed to initialize.',
  );
}

/**
 * Safely picks the first person landmark list from MediaPipe detectForVideo output.
 * Returns null when landmarks are missing, empty, or not an array — never throws
 * on `landmarks?.[0]` when the result shape is partial.
 */
export function firstPersonLandmarks(
  result: { landmarks?: unknown } | null | undefined,
): Array<{ x: number; y: number; z?: number; visibility?: number; presence?: number }> | null {
  const people = result?.landmarks;
  const person = Array.isArray(people) ? people[0] : undefined;
  if (!Array.isArray(person) || person.length === 0) return null;
  return person as Array<{
    x: number;
    y: number;
    z?: number;
    visibility?: number;
    presence?: number;
  }>;
}

/** HEAD/GET probe so a missing model fails with an operator-facing message. */
export async function probeLocalPoseModel(
  path: string,
  fetchFn: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const head = await fetchFn(path, { method: 'HEAD', cache: 'no-store' });
    if (head.ok) return true;
    // Some static hosts omit HEAD — fall back to a ranged GET.
    if (head.status === 405 || head.status === 501) {
      const get = await fetchFn(path, {
        method: 'GET',
        headers: { Range: 'bytes=0-0' },
        cache: 'no-store',
      });
      return get.ok || get.status === 206;
    }
    return false;
  } catch {
    return false;
  }
}

function reasonFrom(error: unknown): string {
  if (error instanceof Error && error.message) {
    const message = error.message.slice(0, 200);
    if (/404|failed to fetch|load.*model|Not Found/i.test(message)) {
      return LOCAL_MODEL_MISSING;
    }
    return message;
  }
  return 'MediaPipe Pose Landmarker failed to initialize.';
}
