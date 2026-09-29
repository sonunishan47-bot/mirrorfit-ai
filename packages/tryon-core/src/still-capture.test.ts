import { describe, expect, it } from 'vitest';

import { fitFromPose } from './landmark-fitting-engine';
import type { PoseFrame } from './geometry';
import { overlaySourceForSelection } from './overlay-source';
import { resolveFitCategory } from './fit-category';
import {
  STILL_JPEG_QUALITY,
  STILL_LONG_EDGE_PX,
  isJpegPayload,
  scaledStillSize,
  stillCaptureDecision,
  validateStillJpeg,
} from './still-capture';

const EMPTY_POSE: PoseFrame = { timestampMs: 1, confidence: 1, keypoints: [] };

describe('still capture policy', () => {
  it('scales the long edge to 1280 and keeps aspect', () => {
    expect(scaledStillSize(1920, 1080)).toEqual({ width: STILL_LONG_EDGE_PX, height: 720 });
    expect(scaledStillSize(800, 1000)).toEqual({ width: 800, height: 1000 });
    expect(scaledStillSize(0, 100)).toBeNull();
    expect(STILL_JPEG_QUALITY).toBeCloseTo(0.85);
  });

  it('requires a person, a visible body, an active session, and a garment', () => {
    expect(
      stillCaptureDecision({
        personDetected: true,
        bodyConfidence: 0.4,
        sessionActive: true,
        garmentSelected: true,
      }).ok,
    ).toBe(true);
    expect(
      stillCaptureDecision({
        personDetected: false,
        bodyConfidence: 0.4,
        sessionActive: true,
        garmentSelected: true,
      }),
    ).toEqual({ ok: false, reason: 'NO_PERSON' });
    expect(
      stillCaptureDecision({
        personDetected: true,
        bodyConfidence: 0.01,
        sessionActive: true,
        garmentSelected: true,
      }),
    ).toEqual({ ok: false, reason: 'BODY_NOT_VISIBLE' });
    expect(
      stillCaptureDecision({
        personDetected: true,
        bodyConfidence: 0.4,
        sessionActive: false,
        garmentSelected: true,
      }),
    ).toEqual({ ok: false, reason: 'SESSION_INACTIVE' });
  });

  it('accepts a real JPEG header inside the size window and rejects the rest', () => {
    const jpeg = new Uint8Array(2048);
    jpeg[0] = 0xff;
    jpeg[1] = 0xd8;
    jpeg[2] = 0xff;
    expect(isJpegPayload(jpeg)).toBe(true);
    expect(validateStillJpeg(jpeg).ok).toBe(true);
    expect(validateStillJpeg(new Uint8Array([0xff, 0xd8, 0xff])).ok).toBe(false);
    const png = new Uint8Array(2048);
    png[0] = 0x89;
    expect(validateStillJpeg(png)).toEqual({ ok: false, reason: 'NOT_JPEG' });
  });
});

describe('full-body categories stay off the 2D warp', () => {
  it('maps churidar, dress, abaya, kurta, and thobe to FULL_BODY', () => {
    expect(resolveFitCategory('Churidar')).toBe('FULL_BODY');
    expect(resolveFitCategory('Dress')).toBe('FULL_BODY');
    expect(resolveFitCategory('Abaya')).toBe('FULL_BODY');
    expect(resolveFitCategory('Kurta')).toBe('FULL_BODY');
    expect(resolveFitCategory('Thobe')).toBe('FULL_BODY');
    expect(resolveFitCategory('Shirt')).toBe('TOP');
    expect(resolveFitCategory('Jeans')).toBe('LOWER_BODY');
    expect(resolveFitCategory('Hats')).toBeNull();
  });

  it('does not produce a 2D fit or overlay for FULL_BODY', () => {
    expect(
      fitFromPose(EMPTY_POSE, null, {
        garmentId: 'g',
        variantId: 'v',
        category: 'Churidar',
      }),
    ).toEqual({ fit: null, status: 'not_ready' });
    expect(
      overlaySourceForSelection({
        selected: true,
        isTestFixture: true,
        fitCategory: 'FULL_BODY',
        hasOverlayAsset: true,
      }),
    ).toBe('none');
  });
});
