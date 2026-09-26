import { describe, expect, it } from 'vitest';

import { deriveBodyGeometry } from './body-geometry';
import type { PoseFrame } from './geometry';
import { deriveLowerBodyGeometry } from './lower-body-geometry';
import {
  lowerBodyWarpParallelogram,
  torsoWarpParallelogram,
} from './pose-warp';

const TOP_POSE: PoseFrame = {
  timestampMs: 1,
  confidence: 0.9,
  keypoints: [
    { name: 'LEFT_SHOULDER', x: 0.35, y: 0.3, z: null, confidence: 0.9 },
    { name: 'RIGHT_SHOULDER', x: 0.65, y: 0.3, z: null, confidence: 0.9 },
    { name: 'LEFT_HIP', x: 0.4, y: 0.6, z: null, confidence: 0.85 },
    { name: 'RIGHT_HIP', x: 0.6, y: 0.6, z: null, confidence: 0.85 },
  ],
};

const LOWER_POSE: PoseFrame = {
  timestampMs: 2,
  confidence: 0.9,
  keypoints: [
    { name: 'LEFT_HIP', x: 0.4, y: 0.55, z: null, confidence: 0.9 },
    { name: 'RIGHT_HIP', x: 0.6, y: 0.55, z: null, confidence: 0.9 },
    { name: 'LEFT_ANKLE', x: 0.42, y: 0.92, z: null, confidence: 0.85 },
    { name: 'RIGHT_ANKLE', x: 0.58, y: 0.92, z: null, confidence: 0.85 },
  ],
};

describe('pose-warp parallelograms', () => {
  it('builds a torso parallelogram from real shoulder/hip geometry', () => {
    const geometry = deriveBodyGeometry(TOP_POSE);
    expect(geometry).not.toBeNull();
    const quad = torsoWarpParallelogram(geometry!);
    expect(quad).not.toBeNull();
    expect(quad!.topLeft.x).toBeLessThan(quad!.topRight.x);
    expect(quad!.topLeft.y).toBeLessThan(quad!.bottomLeft.y);
  });

  it('builds a lower-body parallelogram from hip/ankle geometry', () => {
    const lower = deriveLowerBodyGeometry(LOWER_POSE);
    expect(lower).not.toBeNull();
    expect(lower!.hipWidth).toBeCloseTo(0.2);
    expect(lower!.legLength).toBeGreaterThan(0.3);
    const quad = lowerBodyWarpParallelogram(lower!);
    expect(quad).not.toBeNull();
    expect(quad!.bottomLeft.y).toBeGreaterThan(quad!.topLeft.y);
  });

  it('falls back to knees when ankles are missing', () => {
    const kneeOnly: PoseFrame = {
      timestampMs: 3,
      confidence: 0.9,
      keypoints: [
        { name: 'LEFT_HIP', x: 0.4, y: 0.55, z: null, confidence: 0.9 },
        { name: 'RIGHT_HIP', x: 0.6, y: 0.55, z: null, confidence: 0.9 },
        { name: 'LEFT_KNEE', x: 0.42, y: 0.75, z: null, confidence: 0.85 },
        { name: 'RIGHT_KNEE', x: 0.58, y: 0.75, z: null, confidence: 0.85 },
      ],
    };
    const lower = deriveLowerBodyGeometry(kneeOnly);
    expect(lower).not.toBeNull();
    expect(lower!.legLength).toBeGreaterThan(0.15);
  });

  it('does not invent lower geometry without hips', () => {
    expect(
      deriveLowerBodyGeometry({
        timestampMs: 4,
        confidence: 1,
        keypoints: [
          { name: 'LEFT_ANKLE', x: 0.4, y: 0.9, z: null, confidence: 0.9 },
          { name: 'RIGHT_ANKLE', x: 0.6, y: 0.9, z: null, confidence: 0.9 },
        ],
      }),
    ).toBeNull();
  });
});
