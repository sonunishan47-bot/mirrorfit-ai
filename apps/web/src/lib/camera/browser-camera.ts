import type { CameraConstraints, CameraFrame, CameraProvider } from '@mirrorfit/tryon-core';

/**
 * Browser `getUserMedia` implementation of the camera seam.
 *
 * Frames stay in this process. The only thing `readFrame` returns is a
 * reference to the local `<video>` element; nothing here posts, uploads,
 * or serialises pixels. That is the privacy rule, not a comment on a
 * missing feature: there is no upload path to add later in this module.
 *
 * Injectable ports exist so the lifecycle can be tested without a webcam
 * or a DOM. Production callers omit them and the real browser APIs are used.
 *
 * Start is resilient for physical kiosks: soft constraint fallbacks, a short
 * retry when the device is briefly busy (Strict Mode remount / exclusive
 * lock), and a stable error message for the operator UI.
 */
export interface CameraVideoElement {
  srcObject: MediaProvider | null;
  muted: boolean;
  playsInline: boolean;
  readonly videoWidth: number;
  readonly videoHeight: number;
  play(): Promise<void>;
  addEventListener(type: 'loadedmetadata', listener: () => void): void;
  removeEventListener(type: 'loadedmetadata', listener: () => void): void;
}

export interface BrowserCameraPorts {
  readonly getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  readonly createVideo: () => CameraVideoElement;
  readonly now: () => number;
  /** Max wait for video dimensions after play (ms). */
  readonly playTimeoutMs: number;
  /** Delay before retrying a NotReadableError / AbortError (ms). */
  readonly busyRetryDelayMs: number;
}

function defaultGetUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream> {
  const devices = globalThis.navigator?.mediaDevices;
  if (!devices?.getUserMedia) {
    return Promise.reject(
      Object.assign(new Error('Camera requires a secure HTTPS origin'), {
        name: 'SecurityError',
      }),
    );
  }
  return devices.getUserMedia(constraints);
}

function defaultCreateVideo(): CameraVideoElement {
  if (typeof document === 'undefined') {
    throw new Error('Camera video element requires a document');
  }
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  return video;
}

function defaultNow(): number {
  return performance.now();
}

function toMediaConstraints(
  constraints: CameraConstraints,
  level: 'preferred' | 'reduced' | 'minimal',
): MediaStreamConstraints {
  // Microphone is never requested. The kiosk Permissions-Policy already
  // denies it; asking would be a second, quieter way to turn it on.
  if (level === 'minimal') {
    if (constraints.deviceId !== undefined) {
      return {
        audio: false,
        video: { deviceId: { exact: constraints.deviceId } },
      };
    }
    return { audio: false, video: true };
  }

  const width = level === 'preferred' ? constraints.width : Math.min(constraints.width, 1280);
  const height = level === 'preferred' ? constraints.height : Math.min(constraints.height, 720);
  const frameRate =
    level === 'preferred' ? constraints.frameRate : Math.min(constraints.frameRate, 24);

  const video: MediaTrackConstraints = {
    width: { ideal: width },
    height: { ideal: height },
    frameRate: { ideal: frameRate },
  };
  if (constraints.deviceId !== undefined) {
    video.deviceId = { exact: constraints.deviceId };
  } else {
    // Mirror kiosks face the customer; prefer the user-facing / default webcam
    // over IR or secondary capture devices when the UA supports facingMode.
    video.facingMode = { ideal: 'user' };
  }

  return { audio: false, video };
}

function stopStream(stream: MediaStream | null): void {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

function errorName(error: unknown): string {
  if (
    error &&
    typeof error === 'object' &&
    'name' in error &&
    typeof (error as { name: unknown }).name === 'string'
  ) {
    return (error as { name: string }).name;
  }
  return '';
}

function isBusyDeviceError(error: unknown): boolean {
  const name = errorName(error);
  return name === 'NotReadableError' || name === 'AbortError' || name === 'TrackStartError';
}

function isPermissionOrSecurityError(error: unknown): boolean {
  const name = errorName(error);
  return name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError';
}

function isCancelledStart(error: unknown): boolean {
  return error instanceof Error && error.message.includes('cancelled');
}

/**
 * Operator-facing reason for a failed start. Keeps DOMException names out of
 * the glass when a plain sentence is clearer.
 */
export function describeCameraStartError(error: unknown): string {
  if (isCancelledStart(error)) {
    return 'Camera start was cancelled';
  }
  const name = errorName(error);
  const message = error instanceof Error ? error.message : '';

  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return 'Camera permission is blocked for this site. Allow camera in the browser, then reload.';
  }
  if (name === 'SecurityError' || /secure HTTPS origin/i.test(message)) {
    return 'Camera needs HTTPS. Open the mirror on the HTTPS kiosk URL (not plain HTTP).';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'No camera was found. Check the USB/webcam connection and OS camera privacy settings.';
  }
  if (isBusyDeviceError(error)) {
    return 'Camera is busy in another app. Close it, then reload /mirror.';
  }
  if (name === 'OverconstrainedError' || name === 'ConstraintNotSatisfiedError') {
    return 'Camera rejected the requested resolution. Reloading usually picks a supported mode.';
  }
  if (/timed out/i.test(message)) {
    return 'Camera opened but never delivered a frame. Try another browser profile or device.';
  }
  if (message) {
    return message;
  }
  return 'Camera failed to start';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class BrowserCameraProvider implements CameraProvider {
  readonly #ports: BrowserCameraPorts;
  #stream: MediaStream | null = null;
  #video: CameraVideoElement | null = null;
  #running = false;
  #generation = 0;
  #lastError: string | null = null;

  constructor(ports?: Partial<BrowserCameraPorts>) {
    this.#ports = {
      getUserMedia: ports?.getUserMedia ?? defaultGetUserMedia,
      createVideo: ports?.createVideo ?? defaultCreateVideo,
      now: ports?.now ?? defaultNow,
      playTimeoutMs:
        typeof ports?.playTimeoutMs === 'number' &&
        Number.isFinite(ports.playTimeoutMs) &&
        ports.playTimeoutMs > 0
          ? ports.playTimeoutMs
          : 10_000,
      busyRetryDelayMs:
        typeof ports?.busyRetryDelayMs === 'number' &&
        Number.isFinite(ports.busyRetryDelayMs) &&
        ports.busyRetryDelayMs >= 0
          ? ports.busyRetryDelayMs
          : 350,
    };
  }

  get isRunning(): boolean {
    return this.#running;
  }

  /** Last start failure, cleared on a successful start. */
  get lastError(): string | null {
    return this.#lastError;
  }

  async start(constraints: CameraConstraints): Promise<void> {
    if (this.#running) {
      await this.stop();
    }

    const generation = ++this.#generation;
    this.#lastError = null;

    const levels: Array<'preferred' | 'reduced' | 'minimal'> = [
      'preferred',
      'reduced',
      'minimal',
    ];

    let lastError: unknown = new Error('Camera failed to start');

    for (let levelIndex = 0; levelIndex < levels.length; levelIndex += 1) {
      const level = levels[levelIndex]!;
      const mediaConstraints = toMediaConstraints(constraints, level);

      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (generation !== this.#generation) {
          throw new Error('Camera start was cancelled');
        }

        let stream: MediaStream | null = null;
        let video: CameraVideoElement | null = null;
        try {
          stream = await this.#ports.getUserMedia(mediaConstraints);
          if (generation !== this.#generation) {
            throw new Error('Camera start was cancelled');
          }
          video = this.#ports.createVideo();
          video.muted = true;
          video.playsInline = true;
          video.srcObject = stream;
          await waitUntilPlayable(video, this.#ports.playTimeoutMs);
          if (generation !== this.#generation) {
            throw new Error('Camera start was cancelled');
          }
          this.#stream = stream;
          this.#video = video;
          this.#running = true;
          this.#lastError = null;
          return;
        } catch (error) {
          if (video) {
            video.srcObject = null;
          }
          stopStream(stream);
          lastError = error;

          if (isCancelledStart(error) || generation !== this.#generation) {
            this.#lastError = describeCameraStartError(error);
            throw error instanceof Error ? error : new Error('Camera start was cancelled');
          }

          // Permission / insecure origin will not improve with softer constraints.
          if (isPermissionOrSecurityError(error)) {
            this.#lastError = describeCameraStartError(error);
            throw error;
          }

          // Device briefly exclusive after a remount — retry once at this level.
          if (isBusyDeviceError(error) && attempt === 0) {
            await delay(this.#ports.busyRetryDelayMs);
            continue;
          }

          // Try the next softer constraint level.
          break;
        }
      }
    }

    this.#lastError = describeCameraStartError(lastError);
    throw lastError instanceof Error ? lastError : new Error(this.#lastError);
  }

  async stop(): Promise<void> {
    this.#generation += 1;
    const stream = this.#stream;
    const video = this.#video;
    this.#running = false;
    this.#stream = null;
    this.#video = null;
    if (video) {
      video.srcObject = null;
    }
    stopStream(stream);
  }

  /**
   * Latest local frame, or null.
   *
   * Null before start, after stop, and while the stream is up but the
   * element has no dimensions yet. That last case is not a frame of zeros;
   * it is "no sample", the same rule as every other metric in this system.
   */
  readFrame(): CameraFrame | null {
    const video = this.#video;
    if (!this.#running || !video) {
      return null;
    }
    if (video.videoWidth === 0 || video.videoHeight === 0) {
      return null;
    }
    return {
      timestampMs: this.#ports.now(),
      width: video.videoWidth,
      height: video.videoHeight,
      source: video as CanvasImageSource,
    };
  }

  async dispose(): Promise<void> {
    await this.stop();
  }
}

function waitUntilPlayable(video: CameraVideoElement, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | 0 = 0;

    const cleanup = () => {
      video.removeEventListener('loadedmetadata', onReady);
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        timeoutHandle = 0;
      }
    };

    const succeed = () => {
      if (settled) return;
      if (video.videoWidth <= 0 || video.videoHeight <= 0) return;
      settled = true;
      cleanup();
      resolve();
    };

    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error instanceof Error ? error : new Error('Camera play failed'));
    };

    const onReady = () => {
      succeed();
    };

    video.addEventListener('loadedmetadata', onReady);
    // Metadata may already be available (listener would miss the event).
    succeed();
    if (settled) return;

    timeoutHandle = setTimeout(() => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        succeed();
        return;
      }
      fail(new Error('Camera play timed out'));
    }, timeoutMs);

    void video.play().then(
      () => {
        succeed();
      },
      (error: unknown) => {
        // Muted autoplay can report a rejection while the element is already
        // decoding — treat a sized feed as success, otherwise surface the error.
        if (video.videoWidth > 0 && video.videoHeight > 0) {
          succeed();
          return;
        }
        fail(error);
      },
    );
  });
}
