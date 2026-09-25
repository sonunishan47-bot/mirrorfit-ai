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
}

function defaultGetUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream> {
  const devices = globalThis.navigator?.mediaDevices;
  if (!devices?.getUserMedia) {
    return Promise.reject(new Error('Camera is not available in this environment'));
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

function toMediaConstraints(constraints: CameraConstraints): MediaStreamConstraints {
  const video: MediaTrackConstraints = {
    width: { ideal: constraints.width },
    height: { ideal: constraints.height },
    frameRate: { ideal: constraints.frameRate },
  };
  if (constraints.deviceId !== undefined) {
    video.deviceId = { exact: constraints.deviceId };
  }

  // Microphone is never requested. The kiosk Permissions-Policy already
  // denies it; asking would be a second, quieter way to turn it on.
  return { audio: false, video };
}

function stopStream(stream: MediaStream | null): void {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

export class BrowserCameraProvider implements CameraProvider {
  readonly #ports: BrowserCameraPorts;
  #stream: MediaStream | null = null;
  #video: CameraVideoElement | null = null;
  #running = false;

  constructor(ports?: Partial<BrowserCameraPorts>) {
    this.#ports = {
      getUserMedia: ports?.getUserMedia ?? defaultGetUserMedia,
      createVideo: ports?.createVideo ?? defaultCreateVideo,
      now: ports?.now ?? defaultNow,
    };
  }

  get isRunning(): boolean {
    return this.#running;
  }

  async start(constraints: CameraConstraints): Promise<void> {
    if (this.#running) {
      await this.stop();
    }

    let stream: MediaStream | null = null;
    try {
      stream = await this.#ports.getUserMedia(toMediaConstraints(constraints));
      const video = this.#ports.createVideo();
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      await waitUntilPlayable(video);
      this.#stream = stream;
      this.#video = video;
      this.#running = true;
    } catch (error) {
      stopStream(stream);
      throw error;
    }
  }

  async stop(): Promise<void> {
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

function waitUntilPlayable(video: CameraVideoElement): Promise<void> {
  if (video.videoWidth > 0 && video.videoHeight > 0) {
    return video.play();
  }

  return new Promise((resolve, reject) => {
    const onReady = () => {
      video.removeEventListener('loadedmetadata', onReady);
      resolve();
    };
    video.addEventListener('loadedmetadata', onReady);
    video.play().then(() => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        onReady();
      }
    }, reject);
  });
}
