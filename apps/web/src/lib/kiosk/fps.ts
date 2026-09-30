import type { CameraFrame, FrameRateCounter } from '@mirrorfit/tryon-core';

/**
 * Records a local camera frame and returns the measured FPS.
 *
 * No frame, or fewer than two frames, yields null. Never substitutes 0.
 */
export function noteCameraFrame(
  counter: FrameRateCounter,
  frame: CameraFrame | null,
): number | null {
  if (frame) {
    counter.tick(frame.timestampMs);
  }
  return counter.fps();
}
