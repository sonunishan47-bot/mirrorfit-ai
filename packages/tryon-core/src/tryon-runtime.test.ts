import { describe, expect, it } from 'vitest';

import { presentTryOn, reduceTryOn } from './tryon-runtime';
import { OverlayRenderer, resolveDrawAlpha } from './overlay-renderer';
import {
  parseGarmentAssetRef,
  TEST_FIXTURE_OVERLAY_ASSET,
  validateGarmentAssetMetadata,
} from './garment-asset';

describe('try-on runtime inside ACTIVE', () => {
  it('moves through pose and garment states without touching session lifecycle', () => {
    let status = reduceTryOn('CAMERA_READY', 'POSE_START');
    status = reduceTryOn(status, 'POSE_READY');
    status = reduceTryOn(status, 'GARMENT_CHOSEN');
    status = reduceTryOn(status, 'FIT_READY');
    status = reduceTryOn(status, 'FIT_READY');
    expect(status).toBe('PREVIEW');
    expect(reduceTryOn(status, 'RESET')).toBe('CAMERA_READY');
  });

  it('records an unavailable provider instead of inventing a ready pose', () => {
    const status = reduceTryOn('CAMERA_READY', 'PROVIDER_MISSING');
    expect(status).toBe('PROVIDER_UNAVAILABLE');
    expect(presentTryOn(status).honesty.toLowerCase()).toContain('no pose model');
  });

  it('clears a garment back to pose-ready', () => {
    const status = reduceTryOn('GARMENT_SELECTED', 'GARMENT_CLEARED');
    expect(status).toBe('POSE_READY');
  });

  it('records no-person and fit-not-ready without inventing a preview', () => {
    let status = reduceTryOn('POSE_READY', 'PERSON_LOST');
    expect(status).toBe('NO_PERSON_DETECTED');
    expect(presentTryOn(status).label.toLowerCase()).toContain('no person');
    status = reduceTryOn(status, 'PERSON_SEEN');
    status = reduceTryOn(status, 'GARMENT_CHOSEN');
    status = reduceTryOn(status, 'FIT_NOT_READY');
    expect(status).toBe('FIT_NOT_READY');
    expect(presentTryOn(status).honesty.toLowerCase()).toContain('not confident');
  });

  it('does not leave PROVIDER_UNAVAILABLE because a garment was selected', () => {
    const status = reduceTryOn('PROVIDER_UNAVAILABLE', 'GARMENT_CHOSEN');
    expect(status).toBe('PROVIDER_UNAVAILABLE');
  });

  it('uses the acceptance labels for the four pose/fit states', () => {
    expect(presentTryOn('PROVIDER_UNAVAILABLE').label).toBe('POSE PROVIDER UNAVAILABLE');
    expect(presentTryOn('NO_PERSON_DETECTED').label).toBe('NO PERSON DETECTED');
    expect(presentTryOn('POSE_READY').label).toBe('POSE READY');
    expect(presentTryOn('FIT_NOT_READY').label).toBe('FIT NOT READY');
  });

  it('resets try-on state between ACTIVE sessions without carrying a preview', () => {
    let first = reduceTryOn('CAMERA_READY', 'POSE_START');
    first = reduceTryOn(first, 'POSE_READY');
    first = reduceTryOn(first, 'GARMENT_CHOSEN');
    first = reduceTryOn(first, 'FIT_READY');
    first = reduceTryOn(first, 'FIT_READY');
    expect(first).toBe('PREVIEW');
    const afterEnd = reduceTryOn(first, 'RESET');
    expect(afterEnd).toBe('CAMERA_READY');
    let second = reduceTryOn(afterEnd, 'POSE_START');
    second = reduceTryOn(second, 'POSE_READY');
    expect(second).toBe('POSE_READY');
    expect(second).not.toBe('PREVIEW');
    expect(second).not.toBe('GARMENT_SELECTED');
  });

  it('stays in PREVIEW when the same garment keeps fitting (no per-frame flicker)', () => {
    let status = reduceTryOn('CAMERA_READY', 'POSE_START');
    status = reduceTryOn(status, 'POSE_READY');
    status = reduceTryOn(status, 'GARMENT_CHOSEN');
    status = reduceTryOn(status, 'FIT_READY');
    status = reduceTryOn(status, 'FIT_READY');
    expect(status).toBe('PREVIEW');
    expect(reduceTryOn(status, 'PERSON_SEEN')).toBe('PREVIEW');
    expect(reduceTryOn(status, 'FIT_READY')).toBe('PREVIEW');
    expect(reduceTryOn(status, 'PERSON_LOST')).toBe('NO_PERSON_DETECTED');
  });
});

describe('overlay renderer', () => {
  it('clears and does not invent a garment when fit is null', async () => {
    const commands: string[] = [];
    const canvas = {
      width: 10,
      height: 10,
      getContext: () =>
        ({
          clearRect: () => {
            commands.push('clear');
          },
        }) as unknown as CanvasRenderingContext2D,
    };
    const renderer = new OverlayRenderer();
    renderer.attach(canvas);
    await renderer.initialize({ width: 64, height: 48 });
    expect(canvas.width).toBe(64);
    const timing = await renderer.render(
      { timestampMs: 1, width: 64, height: 48, source: {} as CanvasImageSource },
      null,
    );
    expect(timing.durationMs).toBeGreaterThanOrEqual(0);
    expect(commands).toContain('clear');
    await renderer.dispose();
  });

  it('draws the overlay only when a fit and bitmap exist', async () => {
    const commands: string[] = [];
    const canvas = {
      width: 100,
      height: 100,
      getContext: () =>
        ({
          clearRect: () => {
            commands.push('clear');
          },
          save: () => {
            commands.push('save');
          },
          restore: () => {
            commands.push('restore');
          },
          translate: (x: number, y: number) => {
            commands.push(`translate:${x},${y}`);
          },
          rotate: () => {
            commands.push('rotate');
          },
          drawImage: () => {
            commands.push('draw');
          },
        }) as unknown as CanvasRenderingContext2D,
    };
    const renderer = new OverlayRenderer();
    renderer.attach(canvas);
    renderer.setOverlay({} as CanvasImageSource);
    await renderer.render(
      { timestampMs: 1, width: 100, height: 100, source: {} as CanvasImageSource },
      {
        timestampMs: 1,
        confidence: 0.8,
        transform: {
          translate: { x: 0.25, y: 0.4 },
          scaleX: 0.3,
          scaleY: 0.4,
          rotation: 0,
        },
      },
    );
    expect(commands).toEqual(['clear', 'save', 'translate:25,40', 'rotate', 'draw', 'restore']);
    await renderer.dispose();
  });

  it('does not draw when pose confidence is insufficient', async () => {
    const commands: string[] = [];
    const canvas = {
      width: 10,
      height: 10,
      getContext: () =>
        ({
          clearRect: () => {
            commands.push('clear');
          },
          save: () => {
            commands.push('save');
          },
          drawImage: () => {
            commands.push('draw');
          },
        }) as unknown as CanvasRenderingContext2D,
    };
    const renderer = new OverlayRenderer();
    renderer.attach(canvas);
    renderer.setOverlay({} as CanvasImageSource);
    await renderer.render(
      { timestampMs: 1, width: 10, height: 10, source: {} as CanvasImageSource },
      {
        timestampMs: 1,
        confidence: 0.05,
        transform: {
          translate: { x: 0.5, y: 0.5 },
          scaleX: 0.2,
          scaleY: 0.2,
          rotation: 0,
        },
      },
    );
    expect(commands).toEqual(['clear']);
    await renderer.dispose();
  });

  it('clears immediately when the garment bitmap is removed', async () => {
    const commands: string[] = [];
    const canvas = {
      width: 100,
      height: 100,
      getContext: () =>
        ({
          clearRect: () => {
            commands.push('clear');
          },
          save: () => {
            commands.push('save');
          },
          restore: () => {
            commands.push('restore');
          },
          translate: () => {
            commands.push('translate');
          },
          rotate: () => {
            commands.push('rotate');
          },
          drawImage: () => {
            commands.push('draw');
          },
        }) as unknown as CanvasRenderingContext2D,
    };
    const renderer = new OverlayRenderer();
    renderer.attach(canvas);
    const fit = {
      timestampMs: 1,
      confidence: 0.9,
      transform: {
        translate: { x: 0.5, y: 0.5 },
        scaleX: 0.2,
        scaleY: 0.3,
        rotation: 0,
      },
    };
    renderer.setOverlay({} as CanvasImageSource);
    await renderer.render(
      { timestampMs: 1, width: 100, height: 100, source: {} as CanvasImageSource },
      fit,
    );
    expect(commands).toContain('draw');
    commands.length = 0;
    renderer.setOverlay(null);
    await renderer.render(
      { timestampMs: 2, width: 100, height: 100, source: {} as CanvasImageSource },
      fit,
    );
    expect(commands).toEqual(['clear']);
    await renderer.dispose();
  });

  it('derives draw alpha from confidence and yaw without inventing a mask', () => {
    expect(resolveDrawAlpha(1, { yaw: 0 })).toBeCloseTo(1);
    expect(resolveDrawAlpha(0.8, { yaw: 0.5 })).toBeLessThan(0.8);
    expect(resolveDrawAlpha(0.9, { opacity: 0.4, yaw: 0.9 })).toBeCloseTo(0.4);
  });
});

describe('garment asset contract', () => {
  it('accepts the labelled test fixture', () => {
    expect(parseGarmentAssetRef(TEST_FIXTURE_OVERLAY_ASSET)?.hasAlpha).toBe(true);
    expect(TEST_FIXTURE_OVERLAY_ASSET.kind).toBe('OVERLAY');
  });

  it('rejects an invalid anchor instead of inventing one', () => {
    expect(
      parseGarmentAssetRef({
        ...TEST_FIXTURE_OVERLAY_ASSET,
        anchor: { x: 2, y: 0.2 },
      }),
    ).toBeNull();
  });

  it('labels the built-in shirt as a test fixture, not a product', () => {
    const checked = validateGarmentAssetMetadata(TEST_FIXTURE_OVERLAY_ASSET);
    expect(checked.ok).toBe(true);
    if (checked.ok) expect(checked.kind).toBe('TEST_FIXTURE_ASSET');
  });

  it('rejects overlay metadata without alpha or dimensions', () => {
    expect(
      validateGarmentAssetMetadata({
        ...TEST_FIXTURE_OVERLAY_ASSET,
        hasAlpha: false,
      }).ok,
    ).toBe(false);
    expect(
      validateGarmentAssetMetadata({
        ...TEST_FIXTURE_OVERLAY_ASSET,
        width: null,
        height: null,
      }).ok,
    ).toBe(false);
  });

  it('rejects an unsupported mime type and missing metadata', () => {
    expect(
      validateGarmentAssetMetadata({
        ...TEST_FIXTURE_OVERLAY_ASSET,
        mimeType: 'image/jpeg',
      }),
    ).toEqual({ ok: false, reason: 'UNSUPPORTED_MIME_TYPE' });
    expect(validateGarmentAssetMetadata(null)).toEqual({
      ok: false,
      reason: 'INVALID_ASSET_METADATA',
    });
    expect(
      parseGarmentAssetRef({
        ...TEST_FIXTURE_OVERLAY_ASSET,
        kind: 'NOT_A_KIND',
      }),
    ).toBeNull();
  });
});
