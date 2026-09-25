import { describe, expect, it } from 'vitest';

import { BODY_REGIONS, POSE_LANDMARKS, TRYON_RUNTIME_STATUSES } from './pose';

describe('pose vocabulary', () => {
  it('names the COCO-17 landmarks exactly once', () => {
    expect(POSE_LANDMARKS).toHaveLength(17);
    expect(new Set(POSE_LANDMARKS).size).toBe(17);
    expect(POSE_LANDMARKS).toContain('LEFT_SHOULDER');
    expect(POSE_LANDMARKS).toContain('RIGHT_HIP');
  });

  it('lists body regions the segmentation contract can report', () => {
    expect(BODY_REGIONS).toEqual(['UPPER_BODY', 'LOWER_BODY', 'ARMS', 'HANDS', 'TORSO', 'LEGS']);
  });

  it('keeps try-on runtime states inside ACTIVE, not a second session lifecycle', () => {
    expect(TRYON_RUNTIME_STATUSES).not.toContain('WAITING');
    expect(TRYON_RUNTIME_STATUSES).not.toContain('ACTIVE');
    expect(TRYON_RUNTIME_STATUSES).toContain('PROVIDER_UNAVAILABLE');
    expect(TRYON_RUNTIME_STATUSES).toContain('NO_PERSON_DETECTED');
    expect(TRYON_RUNTIME_STATUSES).toContain('FIT_NOT_READY');
  });
});
