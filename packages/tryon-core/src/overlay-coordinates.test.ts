import { describe, expect, it } from 'vitest';

import { overlayPointFromLandmark } from './overlay-coordinates';

describe('kiosk overlay coordinates', () => {
  it('keeps MediaPipe x when the preview is already CSS-mirrored', () => {
    const point = overlayPointFromLandmark({ x: 0.25, y: 0.4 }, true);
    expect(point).toEqual({ x: 0.25, y: 0.4 });
  });

  it('does not software-flip a CSS-mirrored preview', () => {
    const videoSpace = { x: 0.2, y: 0.5 };
    const drawn = overlayPointFromLandmark(videoSpace, true);
    const mistakenDoubleFlip = { x: 1 - drawn.x, y: drawn.y };
    expect(drawn.x).toBe(0.2);
    expect(mistakenDoubleFlip.x).toBeCloseTo(0.8);
  });

  it('inverts x only when the preview is not CSS-mirrored', () => {
    expect(overlayPointFromLandmark({ x: 0.2, y: 0.5 }, false)).toEqual({
      x: 0.8,
      y: 0.5,
    });
  });
});
