import { describe, expect, it, vi } from 'vitest';

import {
  firstPersonLandmarks,
  MediaPipePoseProvider,
  MEDIAPIPE_POSE_MODEL_DOWNLOAD_URL,
  MEDIAPIPE_POSE_MODEL_PATH,
  MEDIAPIPE_POSE_MODEL_URL,
  probeLocalPoseModel,
} from './mediapipe-pose-provider';

describe('local pose model paths', () => {
  it('serves the model same-origin and pins the Google download URL for the ensure script', () => {
    expect(MEDIAPIPE_POSE_MODEL_PATH).toBe('/mediapipe/models/pose_landmarker_lite.task');
    expect(MEDIAPIPE_POSE_MODEL_URL).toBe(MEDIAPIPE_POSE_MODEL_PATH);
    expect(MEDIAPIPE_POSE_MODEL_DOWNLOAD_URL).toBe(
      'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
    );
  });
});

describe('probeLocalPoseModel', () => {
  it('treats a successful HEAD as present', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    await expect(
      probeLocalPoseModel('/mediapipe/models/pose_landmarker_lite.task', fetchFn),
    ).resolves.toBe(true);
    expect(fetchFn).toHaveBeenCalledWith('/mediapipe/models/pose_landmarker_lite.task', {
      method: 'HEAD',
      cache: 'no-store',
    });
  });

  it('fails closed on 404 without inventing a remote fallback', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    await expect(
      probeLocalPoseModel('/mediapipe/models/pose_landmarker_lite.task', fetchFn),
    ).resolves.toBe(false);
  });

  it('falls back to ranged GET when HEAD is unsupported', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 405 })
      .mockResolvedValueOnce({ ok: false, status: 206 });
    await expect(probeLocalPoseModel('/mediapipe/models/x.task', fetchFn)).resolves.toBe(true);
  });
});

describe('MediaPipePoseProvider dispose', () => {
  it('ignores a late initialize after dispose (no orphan landmarker lifecycle)', async () => {
    const provider = new MediaPipePoseProvider();
    const init = provider.initialize();
    await provider.dispose();
    await init;
    expect(provider.availability).toBe('unavailable');
    expect(
      await provider.processFrame({
        timestampMs: 1,
        width: 640,
        height: 480,
        source: {} as CanvasImageSource,
      }),
    ).toBeNull();
    await provider.dispose();
  });
});

describe('firstPersonLandmarks', () => {
  it('returns null for missing, empty, or non-array landmark results without throwing', () => {
    expect(firstPersonLandmarks(null)).toBeNull();
    expect(firstPersonLandmarks(undefined)).toBeNull();
    expect(firstPersonLandmarks({})).toBeNull();
    expect(firstPersonLandmarks({ landmarks: [] })).toBeNull();
    expect(firstPersonLandmarks({ landmarks: [[]] })).toBeNull();
    expect(firstPersonLandmarks({ landmarks: 'nope' })).toBeNull();
    expect(firstPersonLandmarks({ landmarks: [null] })).toBeNull();
    expect(firstPersonLandmarks({ landmarks: [{}] })).toBeNull();
  });

  it('returns the first person list when MediaPipe shaped output is present', () => {
    const person = [{ x: 0.5, y: 0.2, visibility: 0.9 }];
    expect(firstPersonLandmarks({ landmarks: [person] })).toEqual(person);
  });
});
