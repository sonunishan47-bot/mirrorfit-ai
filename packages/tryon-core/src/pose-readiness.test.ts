import { describe, expect, it } from 'vitest';

import { describePoseReadiness, formatPoseReadiness } from './pose-readiness';
import type { PoseFrame } from './geometry';

const READY = {
  timestampMs: 10,
  confidence: 0.8,
  keypoints: [
    { name: 'LEFT_SHOULDER' as const, x: 0.3, y: 0.3, z: null, confidence: 0.9 },
    { name: 'RIGHT_SHOULDER' as const, x: 0.7, y: 0.3, z: null, confidence: 0.9 },
    { name: 'LEFT_HIP' as const, x: 0.35, y: 0.6, z: null, confidence: 0.85 },
    { name: 'RIGHT_HIP' as const, x: 0.65, y: 0.6, z: null, confidence: 0.85 },
  ],
} satisfies PoseFrame;

describe('pose readiness for TOP fitting', () => {
  it('requires both shoulders and both hips — it does not invent them', () => {
    expect(describePoseReadiness(READY)).toEqual({
      landmarkCount: 4,
      shouldersReady: true,
      hipsReady: true,
      geometryReady: true,
    });
    expect(
      describePoseReadiness({
        ...READY,
        keypoints: READY.keypoints.filter((point) => point.name !== 'LEFT_HIP'),
      }).geometryReady,
    ).toBe(false);
  });

  it('treats a null pose as no landmarks', () => {
    expect(describePoseReadiness(null).landmarkCount).toBe(0);
    expect(formatPoseReadiness(describePoseReadiness(null))).toBe('No landmarks this frame.');
  });

  it('does not treat a low-confidence shoulder as ready', () => {
    const readiness = describePoseReadiness({
      ...READY,
      keypoints: [
        { name: 'LEFT_SHOULDER', x: 0.3, y: 0.3, z: null, confidence: 0.1 },
        { name: 'RIGHT_SHOULDER', x: 0.7, y: 0.3, z: null, confidence: 0.9 },
        { name: 'LEFT_HIP', x: 0.35, y: 0.6, z: null, confidence: 0.85 },
        { name: 'RIGHT_HIP', x: 0.65, y: 0.6, z: null, confidence: 0.85 },
      ],
    });
    expect(readiness.shouldersReady).toBe(false);
    expect(readiness.geometryReady).toBe(false);
  });
});
