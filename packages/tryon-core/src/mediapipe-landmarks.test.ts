import { describe, expect, it } from 'vitest';

import { poseFrameFromMediaPipe, type MediaPipeLandmarkLike } from './mediapipe-landmarks';

/** Synthetic official-shaped MediaPipe output. Test fixture only. */
function blazePose(
  overrides: Partial<Record<number, Partial<MediaPipeLandmarkLike>>> = {},
): MediaPipeLandmarkLike[] {
  const points: MediaPipeLandmarkLike[] = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    z: 0,
    visibility: 0.1,
  }));
  const body: Record<number, MediaPipeLandmarkLike> = {
    0: { x: 0.5, y: 0.15, z: 0, visibility: 0.95 },
    11: { x: 0.35, y: 0.3, z: -0.02, visibility: 0.9 },
    12: { x: 0.65, y: 0.3, z: 0.02, visibility: 0.9 },
    13: { x: 0.3, y: 0.45, z: 0, visibility: 0.8 },
    14: { x: 0.7, y: 0.45, z: 0, visibility: 0.8 },
    15: { x: 0.28, y: 0.58, z: 0, visibility: 0.7 },
    16: { x: 0.72, y: 0.58, z: 0, visibility: 0.7 },
    23: { x: 0.4, y: 0.62, z: 0, visibility: 0.88 },
    24: { x: 0.6, y: 0.62, z: 0, visibility: 0.88 },
    25: { x: 0.4, y: 0.8, z: 0, visibility: 0.7 },
    26: { x: 0.6, y: 0.8, z: 0, visibility: 0.7 },
    27: { x: 0.4, y: 0.95, z: 0, visibility: 0.6 },
    28: { x: 0.6, y: 0.95, z: 0, visibility: 0.6 },
  };
  for (const [index, point] of Object.entries(body)) {
    points[Number(index)] = point;
  }
  for (const [index, point] of Object.entries(overrides)) {
    const current = points[Number(index)];
    if (current) points[Number(index)] = { ...current, ...point };
  }
  return points;
}

describe('poseFrameFromMediaPipe', () => {
  it('maps official BlazePose indices onto COCO-17 names', () => {
    const frame = poseFrameFromMediaPipe(blazePose(), 1200);
    expect(frame).not.toBeNull();
    expect(frame?.timestampMs).toBe(1200);
    expect(frame?.keypoints.find((point) => point.name === 'LEFT_SHOULDER')?.x).toBe(0.35);
    expect(frame?.keypoints.find((point) => point.name === 'RIGHT_HIP')?.y).toBe(0.62);
    expect(frame?.keypoints.some((point) => point.name === 'LEFT_SHOULDER')).toBe(true);
    expect(frame?.confidence).toBeGreaterThan(0.5);
  });

  it('returns null when no person is present', () => {
    expect(poseFrameFromMediaPipe(undefined, 1)).toBeNull();
    expect(poseFrameFromMediaPipe([], 1)).toBeNull();
  });

  it('drops NaN, Infinity, and wildly out-of-frame coordinates instead of inventing them', () => {
    const frame = poseFrameFromMediaPipe(
      blazePose({
        11: { x: Number.NaN, visibility: 0.9 },
        12: { x: Number.POSITIVE_INFINITY, visibility: 0.9 },
        23: { y: -0.8, visibility: 0.9 },
        24: { visibility: Number.NaN },
      }),
      10,
    );
    const names = frame?.keypoints.map((point) => point.name) ?? [];
    expect(names).not.toContain('LEFT_SHOULDER');
    expect(names).not.toContain('RIGHT_SHOULDER');
    expect(names).not.toContain('LEFT_HIP');
    expect(names).not.toContain('RIGHT_HIP');
  });

  it('keeps hips detected slightly past the frame edge so TOP geometry can form', () => {
    const frame = poseFrameFromMediaPipe(
      blazePose({
        23: { x: 0.4, y: 1.08, z: 0, visibility: 0.9 },
        24: { x: 0.6, y: 1.06, z: 0, visibility: 0.88 },
      }),
      20,
    );
    expect(frame?.keypoints.find((point) => point.name === 'LEFT_HIP')?.y).toBe(1.08);
    expect(frame?.keypoints.find((point) => point.name === 'RIGHT_HIP')?.y).toBe(1.06);
  });

  it('returns null when every mapped point is invalid', () => {
    expect(poseFrameFromMediaPipe([{ x: 2, y: 2, visibility: 1 }], 5)).toBeNull();
  });

  it('rejects a non-finite timestamp', () => {
    expect(poseFrameFromMediaPipe(blazePose(), Number.NaN)).toBeNull();
    expect(poseFrameFromMediaPipe(blazePose(), -1)).toBeNull();
  });

  it('uses presence when visibility is missing', () => {
    const frame = poseFrameFromMediaPipe([{ x: 0.5, y: 0.2, presence: 0.8 }], 3);
    expect(frame?.keypoints[0]?.name).toBe('NOSE');
    expect(frame?.keypoints[0]?.confidence).toBe(0.8);
  });

  it('skips sparse landmark holes instead of throwing on point.visibility', () => {
    const sparse: Array<MediaPipeLandmarkLike | undefined> = Array.from({ length: 33 });
    sparse[0] = { x: 0.5, y: 0.15, visibility: 0.9 };
    sparse[11] = { x: 0.35, y: 0.3, visibility: 0.85 };
    sparse[12] = { x: 0.65, y: 0.3, visibility: 0.85 };
    // index 23 intentionally left undefined (hole) — must not throw
    sparse[24] = { x: 0.6, y: 0.62, visibility: 0.8 };
    expect(() => poseFrameFromMediaPipe(sparse, 50)).not.toThrow();
    const frame = poseFrameFromMediaPipe(sparse, 50);
    expect(frame).not.toBeNull();
    expect(frame?.keypoints.some((p) => p.name === 'LEFT_HIP')).toBe(false);
    expect(frame?.keypoints.some((p) => p.name === 'RIGHT_HIP')).toBe(true);
  });

  it('returns null for non-array landmark payloads without throwing', () => {
    expect(poseFrameFromMediaPipe(null, 1)).toBeNull();
    expect(poseFrameFromMediaPipe({}, 1)).toBeNull();
  });
});
