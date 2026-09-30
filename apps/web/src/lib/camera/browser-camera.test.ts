import { describe, expect, it } from 'vitest';

import {
  BrowserCameraProvider,
  describeCameraStartError,
  type CameraVideoElement,
} from './browser-camera';

const CONSTRAINTS = { width: 1280, height: 720, frameRate: 30 };

interface FakeTrack {
  stop(): void;
  readonly stopped: boolean;
}

function createFakeTrack(): FakeTrack {
  let stopped = false;
  return {
    stop() {
      stopped = true;
    },
    get stopped() {
      return stopped;
    },
  };
}

function createFakeStream(tracks: FakeTrack[]): MediaStream {
  return {
    getTracks: () => tracks,
    getVideoTracks: () => tracks,
  } as unknown as MediaStream;
}

function createFakeVideo(
  width: number,
  height: number,
): CameraVideoElement & {
  ready: boolean;
} {
  const listeners = new Set<() => void>();
  const video = {
    srcObject: null as MediaStream | null,
    muted: false,
    playsInline: false,
    videoWidth: 0,
    videoHeight: 0,
    ready: false,
    play() {
      this.videoWidth = width;
      this.videoHeight = height;
      this.ready = true;
      for (const listener of [...listeners]) listener();
      return Promise.resolve();
    },
    addEventListener(_type: 'loadedmetadata', listener: () => void) {
      listeners.add(listener);
    },
    removeEventListener(_type: 'loadedmetadata', listener: () => void) {
      listeners.delete(listener);
    },
  };
  return video;
}

describe('readFrame before start', () => {
  it('returns null when the camera has never been started', () => {
    const camera = new BrowserCameraProvider({
      getUserMedia: () => Promise.reject(new Error('must not be called')),
      createVideo: () => {
        throw new Error('must not be called');
      },
    });

    expect(camera.isRunning).toBe(false);
    expect(camera.readFrame()).toBeNull();
  });
});

describe('start/stop lifecycle', () => {
  it('is running after start and exposes a local frame', async () => {
    const track = createFakeTrack();
    const stream = createFakeStream([track]);
    const video = createFakeVideo(1280, 720);
    let requested: MediaStreamConstraints | undefined;

    const camera = new BrowserCameraProvider({
      getUserMedia: (constraints) => {
        requested = constraints;
        return Promise.resolve(stream);
      },
      createVideo: () => video,
      now: () => 42,
    });

    await camera.start(CONSTRAINTS);

    expect(camera.isRunning).toBe(true);
    expect(requested?.audio).toBe(false);
    expect(video.muted).toBe(true);
    expect(video.srcObject).toBe(stream);

    const frame = camera.readFrame();
    expect(frame).not.toBeNull();
    expect(frame?.width).toBe(1280);
    expect(frame?.height).toBe(720);
    expect(frame?.timestampMs).toBe(42);
    expect(frame?.source).toBe(video);
  });

  it('can start again after stop without leaking the first stream', async () => {
    const first = createFakeTrack();
    const second = createFakeTrack();
    const streams = [createFakeStream([first]), createFakeStream([second])];
    const camera = new BrowserCameraProvider({
      getUserMedia: () => Promise.resolve(streams.shift() ?? createFakeStream([])),
      createVideo: () => createFakeVideo(640, 480),
    });

    await camera.start(CONSTRAINTS);
    await camera.stop();
    expect(first.stopped).toBe(true);

    await camera.start(CONSTRAINTS);
    expect(camera.isRunning).toBe(true);
    expect(second.stopped).toBe(false);
    expect(camera.readFrame()).not.toBeNull();

    await camera.stop();
    expect(second.stopped).toBe(true);
  });

  it('stops the tracks and forgets the frame', async () => {
    const track = createFakeTrack();
    const video = createFakeVideo(640, 480);
    const camera = new BrowserCameraProvider({
      getUserMedia: () => Promise.resolve(createFakeStream([track])),
      createVideo: () => video,
    });

    await camera.start(CONSTRAINTS);
    await camera.stop();

    expect(camera.isRunning).toBe(false);
    expect(track.stopped).toBe(true);
    expect(video.srcObject).toBeNull();
    expect(camera.readFrame()).toBeNull();
  });

  it('stops a stream if dispose happens while getUserMedia is in flight', async () => {
    const track = createFakeTrack();
    let release: ((stream: MediaStream) => void) | undefined;
    const pending = new Promise<MediaStream>((resolve) => {
      release = resolve;
    });
    const camera = new BrowserCameraProvider({
      getUserMedia: () => pending,
      createVideo: () => createFakeVideo(640, 480),
    });

    const starting = camera.start(CONSTRAINTS);
    await camera.dispose();
    release?.(createFakeStream([track]));

    await expect(starting).rejects.toThrow(/cancelled/);
    expect(track.stopped).toBe(true);
    expect(camera.isRunning).toBe(false);
    expect(camera.readFrame()).toBeNull();
  });

  it('releases the stream if start fails after getUserMedia', async () => {
    const track = createFakeTrack();
    const camera = new BrowserCameraProvider({
      getUserMedia: () => Promise.resolve(createFakeStream([track])),
      createVideo: () => {
        throw new Error('no document');
      },
    });

    await expect(camera.start(CONSTRAINTS)).rejects.toThrow('no document');
    expect(camera.isRunning).toBe(false);
    expect(track.stopped).toBe(true);
    expect(camera.readFrame()).toBeNull();
  });
});

describe('dispose cleanup', () => {
  it('stops the stream and leaves the provider idle', async () => {
    const track = createFakeTrack();
    const video = createFakeVideo(1920, 1080);
    const camera = new BrowserCameraProvider({
      getUserMedia: () => Promise.resolve(createFakeStream([track])),
      createVideo: () => video,
    });

    await camera.start(CONSTRAINTS);
    await camera.dispose();

    expect(camera.isRunning).toBe(false);
    expect(track.stopped).toBe(true);
    expect(video.srcObject).toBeNull();
    expect(camera.readFrame()).toBeNull();
  });

  it('is safe to dispose a camera that never started', async () => {
    const camera = new BrowserCameraProvider({
      getUserMedia: () => Promise.reject(new Error('must not be called')),
      createVideo: () => {
        throw new Error('must not be called');
      },
    });

    await camera.dispose();
    expect(camera.isRunning).toBe(false);
    expect(camera.readFrame()).toBeNull();
  });
});

describe('waitUntilPlayable edge cases', () => {
  it('succeeds when metadata is already present before play', async () => {
    const track = createFakeTrack();
    const video = createFakeVideo(1280, 720);
    // Simulate metadata already decoded before play() (listener would miss the event).
    (video as { videoWidth: number; videoHeight: number }).videoWidth = 1280;
    (video as { videoWidth: number; videoHeight: number }).videoHeight = 720;
    const camera = new BrowserCameraProvider({
      getUserMedia: () => Promise.resolve(createFakeStream([track])),
      createVideo: () => video,
      playTimeoutMs: 50,
    });

    await camera.start(CONSTRAINTS);
    expect(camera.isRunning).toBe(true);
    expect(camera.readFrame()?.width).toBe(1280);
    await camera.stop();
  });

  it('succeeds when play() rejects but the element already has a sized feed', async () => {
    const track = createFakeTrack();
    const listeners = new Set<() => void>();
    const video: CameraVideoElement = {
      srcObject: null,
      muted: false,
      playsInline: false,
      videoWidth: 640,
      videoHeight: 480,
      play() {
        return Promise.reject(new Error('play rejected'));
      },
      addEventListener(_type: 'loadedmetadata', listener: () => void) {
        listeners.add(listener);
      },
      removeEventListener(_type: 'loadedmetadata', listener: () => void) {
        listeners.delete(listener);
      },
    };
    const camera = new BrowserCameraProvider({
      getUserMedia: () => Promise.resolve(createFakeStream([track])),
      createVideo: () => video,
      playTimeoutMs: 50,
    });

    await camera.start(CONSTRAINTS);
    expect(camera.isRunning).toBe(true);
    await camera.stop();
  });

  it('fails fast when play never produces dimensions', async () => {
    const track = createFakeTrack();
    const video: CameraVideoElement = {
      srcObject: null,
      muted: false,
      playsInline: false,
      videoWidth: 0,
      videoHeight: 0,
      play() {
        return new Promise(() => {
          /* never settles */
        });
      },
      addEventListener() {
        /* never fires loadedmetadata */
      },
      removeEventListener() {
        /* no-op */
      },
    };
    const camera = new BrowserCameraProvider({
      getUserMedia: () => Promise.resolve(createFakeStream([track])),
      createVideo: () => video,
      playTimeoutMs: 30,
    });

    await expect(camera.start(CONSTRAINTS)).rejects.toThrow(/timed out/);
    expect(track.stopped).toBe(true);
    expect(camera.isRunning).toBe(false);
  });
});

describe('constraint fallbacks and busy retry', () => {
  it('falls back to softer constraints when preferred getUserMedia fails', async () => {
    const track = createFakeTrack();
    const calls: MediaStreamConstraints[] = [];
    const camera = new BrowserCameraProvider({
      getUserMedia: (constraints) => {
        calls.push(constraints);
        if (calls.length === 1) {
          return Promise.reject(
            Object.assign(new Error('overconstrained'), { name: 'OverconstrainedError' }),
          );
        }
        return Promise.resolve(createFakeStream([track]));
      },
      createVideo: () => createFakeVideo(1280, 720),
      busyRetryDelayMs: 0,
    });

    await camera.start(CONSTRAINTS);
    expect(camera.isRunning).toBe(true);
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(calls[0]?.video).toEqual(
      expect.objectContaining({
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: { ideal: 'user' },
      }),
    );
    await camera.stop();
  });

  it('retries once when the device is briefly busy', async () => {
    const track = createFakeTrack();
    let attempts = 0;
    const camera = new BrowserCameraProvider({
      getUserMedia: () => {
        attempts += 1;
        if (attempts === 1) {
          return Promise.reject(Object.assign(new Error('busy'), { name: 'NotReadableError' }));
        }
        return Promise.resolve(createFakeStream([track]));
      },
      createVideo: () => createFakeVideo(640, 480),
      busyRetryDelayMs: 0,
    });

    await camera.start(CONSTRAINTS);
    expect(attempts).toBe(2);
    expect(camera.isRunning).toBe(true);
    await camera.stop();
  });

  it('does not keep retrying after NotAllowedError', async () => {
    let attempts = 0;
    const camera = new BrowserCameraProvider({
      getUserMedia: () => {
        attempts += 1;
        return Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
      },
      createVideo: () => createFakeVideo(640, 480),
      busyRetryDelayMs: 0,
    });

    await expect(camera.start(CONSTRAINTS)).rejects.toMatchObject({ name: 'NotAllowedError' });
    expect(attempts).toBe(1);
    expect(camera.lastError).toMatch(/permission is blocked/i);
  });
});

describe('describeCameraStartError', () => {
  it('explains missing secure context', () => {
    expect(
      describeCameraStartError(
        Object.assign(new Error('Camera requires a secure HTTPS origin'), {
          name: 'SecurityError',
        }),
      ),
    ).toMatch(/HTTPS/i);
  });
});
