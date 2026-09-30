import { describe, expect, it } from 'vitest';

import {
  FIT_HOLD_MAX_FRAMES,
  LANDMARK_JOINT_MIN_CONFIDENCE,
  MIN_POSE_CONFIDENCE,
  OCCLUSION_MIN_POSE_CONFIDENCE,
  OVERLAY_MIN_DRAW_CONFIDENCE,
} from './pose-thresholds';

describe('pose thresholds (laptop-camera tolerant)', () => {
  it('keeps geometry joint floor below the old 0.35 gate but above junk', () => {
    expect(LANDMARK_JOINT_MIN_CONFIDENCE).toBeLessThan(0.35);
    expect(LANDMARK_JOINT_MIN_CONFIDENCE).toBeGreaterThanOrEqual(0.2);
  });

  it('keeps fit / draw / occlusion floors ordered and lenient', () => {
    expect(MIN_POSE_CONFIDENCE).toBeLessThanOrEqual(LANDMARK_JOINT_MIN_CONFIDENCE);
    expect(OVERLAY_MIN_DRAW_CONFIDENCE).toBeLessThanOrEqual(MIN_POSE_CONFIDENCE);
    expect(OCCLUSION_MIN_POSE_CONFIDENCE).toBeLessThanOrEqual(MIN_POSE_CONFIDENCE);
    expect(FIT_HOLD_MAX_FRAMES).toBeGreaterThan(0);
  });
});
