import { describe, expect, it } from 'vitest';

import type { BodyGeometry } from './geometry';
import {
  computeOverlayOpacity,
  postureFadeFromYaw,
  YAW_OPACITY_FLOOR,
} from './pose-occlusion';
import { unavailableBodyRegions } from './unavailable-segmentation';

const FRONT: BodyGeometry = {
  timestampMs: 1,
  shoulderWidth: 0.3,
  torsoHeight: 0.35,
  hipWidth: 0.28,
  yaw: 0,
  roll: 0,
  shoulderCenter: { x: 0.5, y: 0.3 },
  hipCenter: { x: 0.5, y: 0.65 },
  center: { x: 0.5, y: 0.475 },
};

describe('pose-occlusion', () => {
  it('returns full opacity for a confident front-facing pose', () => {
    const result = computeOverlayOpacity({
      geometry: FRONT,
      poseConfidence: 0.9,
      regions: unavailableBodyRegions(1),
    });
    expect(result.overlayOpacity).toBeCloseTo(0.9);
    expect(result.usedSegmentation).toBe(false);
  });

  it('fades when yaw (shoulder z delta) grows', () => {
    const turned = computeOverlayOpacity({
      geometry: { ...FRONT, yaw: 0.4 },
      poseConfidence: 1,
    });
    const front = computeOverlayOpacity({
      geometry: FRONT,
      poseConfidence: 1,
    });
    expect(turned.overlayOpacity).toBeLessThan(front.overlayOpacity);
    expect(turned.overlayOpacity).toBeGreaterThanOrEqual(YAW_OPACITY_FLOOR);
  });

  it('returns zero when geometry is missing — never invents occlusion', () => {
    expect(
      computeOverlayOpacity({ geometry: null, poseConfidence: 1 }).overlayOpacity,
    ).toBe(0);
  });

  it('does not invent a mask from unavailable region maps', () => {
    const result = computeOverlayOpacity({
      geometry: FRONT,
      poseConfidence: 0.8,
      regions: unavailableBodyRegions(2),
    });
    expect(result.usedSegmentation).toBe(false);
    expect(result.overlayOpacity).toBeCloseTo(0.8);
  });

  it('postureFadeFromYaw bottoms out past the end threshold', () => {
    expect(postureFadeFromYaw(0)).toBe(1);
    expect(postureFadeFromYaw(1)).toBe(YAW_OPACITY_FLOOR);
  });
});
