import { describe, expect, it } from 'vitest';

import { STILL_JPEG_QUALITY, STILL_LONG_EDGE_PX } from '@mirrorfit/tryon-core';

import { captureStillJpeg, type StillEncoder } from './capture-still';

describe('captureStillJpeg', () => {
  it('encodes one scaled JPEG and rejects a non-jpeg payload', async () => {
    const draws: Array<{ width: number; height: number }> = [];
    const jpeg = new Uint8Array(2048);
    jpeg[0] = 0xff;
    jpeg[1] = 0xd8;
    jpeg[2] = 0xff;
    const encoder: StillEncoder = {
      draw(_source, width, height) {
        draws.push({ width, height });
      },
      encodeJpeg(quality) {
        expect(quality).toBeCloseTo(STILL_JPEG_QUALITY);
        return Promise.resolve(jpeg);
      },
    };
    const bytes = await captureStillJpeg(
      { width: 1920, height: 1080, source: {} as CanvasImageSource },
      undefined,
      encoder,
    );
    expect(draws).toEqual([{ width: STILL_LONG_EDGE_PX, height: 720 }]);
    expect(bytes).toBe(jpeg);
  });

  it('returns null when the encoder does not produce a JPEG', async () => {
    const encoder: StillEncoder = {
      draw() {},
      encodeJpeg() {
        return Promise.resolve(new Uint8Array(2048));
      },
    };
    expect(
      await captureStillJpeg(
        { width: 640, height: 480, source: {} as CanvasImageSource },
        undefined,
        encoder,
      ),
    ).toBeNull();
  });

  it('does not capture when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    let drew = false;
    const encoder: StillEncoder = {
      draw() {
        drew = true;
      },
      encodeJpeg() {
        return Promise.resolve(null);
      },
    };
    expect(
      await captureStillJpeg(
        { width: 640, height: 480, source: {} as CanvasImageSource },
        controller.signal,
        encoder,
      ),
    ).toBeNull();
    expect(drew).toBe(false);
  });
});
