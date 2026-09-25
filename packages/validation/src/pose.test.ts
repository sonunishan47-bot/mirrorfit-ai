import { POSE_LANDMARKS } from '@mirrorfit/types';
import { describe, expect, it } from 'vitest';

import { keypointSchema, poseFrameSchema, selectedGarmentSchema } from './pose';

describe('pose landmark validation', () => {
  it('accepts a normalized landmark', () => {
    const parsed = keypointSchema.parse({
      name: 'LEFT_SHOULDER',
      x: 0.4,
      y: 0.3,
      z: null,
      confidence: 0.9,
    });
    expect(parsed.x).toBe(0.4);
  });

  it('rejects coordinates outside 0..1', () => {
    expect(() =>
      keypointSchema.parse({
        name: 'NOSE',
        x: 1.2,
        y: 0.5,
        z: null,
        confidence: 1,
      }),
    ).toThrow();
    expect(() =>
      keypointSchema.parse({
        name: 'NOSE',
        x: -0.1,
        y: 0.5,
        z: null,
        confidence: 1,
      }),
    ).toThrow();
  });

  it('rejects confidence outside 0..1', () => {
    expect(() =>
      keypointSchema.parse({
        name: 'NOSE',
        x: 0.5,
        y: 0.5,
        z: null,
        confidence: 1.1,
      }),
    ).toThrow();
  });

  it('rejects an unknown landmark name', () => {
    expect(() =>
      keypointSchema.parse({
        name: 'LEFT_WING',
        x: 0.5,
        y: 0.5,
        z: null,
        confidence: 1,
      }),
    ).toThrow();
  });

  it('rejects a missing timestamp', () => {
    expect(
      poseFrameSchema.safeParse({
        keypoints: [],
        confidence: 0,
      }).success,
    ).toBe(false);
  });

  it('accepts a frame with no landmarks and a finite timestamp', () => {
    const parsed = poseFrameSchema.parse({
      timestampMs: 12,
      keypoints: [],
      confidence: 0,
    });
    expect(parsed.keypoints).toHaveLength(0);
    expect(POSE_LANDMARKS.length).toBeGreaterThan(parsed.keypoints.length);
  });

  it('strips tenant ids from a phone garment payload', () => {
    const parsed = selectedGarmentSchema.parse({
      garment_id: '33333333-3333-4333-8333-333333333333',
      variant_id: '55555555-5555-4555-8555-555555555555',
      organization_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    });
    expect(parsed).not.toHaveProperty('organization_id');
  });
});
