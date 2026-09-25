import type { CameraFrame, PoseProvider } from './providers';
import type { PoseFrame } from './geometry';

/**
 * Fallback when MediaPipe Pose Landmarker cannot initialize.
 *
 * Does not invent landmarks. The kiosk uses this only after a real
 * initialization failure (no window, no WASM, model load error).
 */
export class UnavailablePoseProvider implements PoseProvider {
  readonly name = 'unavailable';
  readonly availability = 'unavailable' as const;
  readonly lastError: string | null;

  constructor(lastError: string | null = 'No pose model is available in this environment.') {
    this.lastError = lastError;
  }

  initialize(): Promise<void> {
    return Promise.resolve();
  }

  estimate(_frame: CameraFrame): Promise<PoseFrame | null> {
    return Promise.resolve(null);
  }

  processFrame(frame: CameraFrame): Promise<PoseFrame | null> {
    return this.estimate(frame);
  }

  dispose(): Promise<void> {
    return Promise.resolve();
  }
}
