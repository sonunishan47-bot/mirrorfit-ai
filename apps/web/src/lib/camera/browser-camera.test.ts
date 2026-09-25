import { describe, expect, it } from 'vitest';

import { BrowserCameraProvider, type CameraVideoElement } from './browser-camera';

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
    async play() {
      this.videoWidth = width;
      this.videoHeight = height;
      this.ready = true;
      for (const listener of [...listeners]) listener();
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
