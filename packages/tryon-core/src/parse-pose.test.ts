import { describe, expect, it } from 'vitest';

import { parseKeypoint, parsePoseFrame } from './parse-pose';

const VALID = {
  name: 'LEFT_SHOULDER',
  x: 0.4,
  y: 0.31,
  z: null,
  confidence: 0.88,
};

describe('pose landmark parsing', () => {
  it('accepts a normalized landmark', () => {
    expect(parseKeypoint(VALID)).toEqual(VALID);
  });

  it('accepts MediaPipe edge coordinates slightly outside the unit square', () => {
    expect(parseKeypoint({ ...VALID, x: 1.05, y: -0.02 })).toEqual({
      ...VALID,
      x: 1.05,
      y: -0.02,
    });
  });

  it('rejects wildly out-of-frame or non-finite coordinates instead of inventing them', () => {
    expect(parseKeypoint({ ...VALID, x: 1.6 })).toBeNull();
    expect(parseKeypoint({ ...VALID, y: -0.6 })).toBeNull();
    expect(parseKeypoint({ ...VALID, x: Number.POSITIVE_INFINITY })).toBeNull();
  });

  it('rejects confidence outside 0..1', () => {
    expect(parseKeypoint({ ...VALID, confidence: 2 })).toBeNull();
    expect(parseKeypoint({ ...VALID, confidence: Number.NaN })).toBeNull();
  });

  it('rejects Infinity confidence and z', () => {
    expect(parseKeypoint({ ...VALID, confidence: Number.POSITIVE_INFINITY })).toBeNull();
    expect(parseKeypoint({ ...VALID, z: Number.POSITIVE_INFINITY })).toBeNull();
  });

  it('rejects a missing landmark name', () => {
    expect(parseKeypoint({ ...VALID, name: 'UNKNOWN' })).toBeNull();
  });

  it('rejects a frame without a finite timestamp', () => {
    expect(
      parsePoseFrame({
        timestampMs: Number.NaN,
        keypoints: [VALID],
        confidence: 0.5,
      }),
    ).toBeNull();
  });

  it('accepts a frame that has no landmarks yet', () => {
    expect(
      parsePoseFrame({
        timestampMs: 10,
        keypoints: [],
        confidence: 0,
      }),
    ).toEqual({ timestampMs: 10, keypoints: [], confidence: 0 });
  });

  it('rejects duplicate landmark names in one frame', () => {
    expect(
      parsePoseFrame({
        timestampMs: 10,
        keypoints: [VALID, VALID],
        confidence: 0.4,
      }),
    ).toBeNull();
  });
});
