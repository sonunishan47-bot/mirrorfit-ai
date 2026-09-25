import { FrameRateCounter } from '@mirrorfit/tryon-core';
import { describe, expect, it } from 'vitest';

import { noteCameraFrame } from './fps';

const source = {} as CanvasImageSource;

describe('kiosk FPS sampling', () => {
  it('is null before any valid camera samples', () => {
    const counter = new FrameRateCounter();
    expect(noteCameraFrame(counter, null)).toBeNull();
    expect(noteCameraFrame(counter, { timestampMs: 0, width: 10, height: 10, source })).toBeNull();
  });

  it('reports a real FPS after two samples', () => {
    const counter = new FrameRateCounter();
    noteCameraFrame(counter, { timestampMs: 0, width: 10, height: 10, source });
    const fps = noteCameraFrame(counter, {
      timestampMs: 100,
      width: 10,
      height: 10,
      source,
    });
    expect(fps).toBe(10);
    expect(fps).not.toBeNull();
    expect(fps).not.toBe(0);
  });
});
