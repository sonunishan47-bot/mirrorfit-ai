/**
 * STATUS: PROVIDER UNAVAILABLE — NOT PRODUCTION READY.
 *
 * This in-process provider does not run a photorealistic model and does not
 * upload frames. A consented still, when the customer allows it, goes through
 * the server try-on job and the pod worker — not through this class.
 *
 * Callers must keep the local pose-geometry overlay when generate() returns
 * null. This module never invents a fake "AI ready" image.
 */

import type { CameraFrame, Disposable } from './providers';
import type { FittingResult } from './geometry';

export type PhotorealisticAvailability = 'ready' | 'unavailable' | 'initializing';

export interface PhotorealisticTryOnRequest {
  readonly frame: CameraFrame;
  readonly fit: FittingResult;
  readonly garmentId: string;
  readonly variantId: string;
}

export interface PhotorealisticTryOnResult {
  readonly timestampMs: number;
  /** Bitmap that would replace the geometric overlay when a real model exists. */
  readonly image: CanvasImageSource;
  readonly confidence: number;
}

export interface PhotorealisticTryOnProvider extends Disposable {
  readonly name: string;
  readonly availability: PhotorealisticAvailability;
  readonly lastError: string | null;
  initialize(): Promise<void>;
  /**
   * Attempts a photorealistic generation. Must return null when unavailable
   * — never a decorative stand-in sold as AI output.
   */
  generate(request: PhotorealisticTryOnRequest): Promise<PhotorealisticTryOnResult | null>;
}

export const PHOTOREALISTIC_UNAVAILABLE_REASON =
  'Photorealistic AI try-on is not integrated. No verified on-device model is present, and camera frames are not uploaded for cloud generation. Using local pose-geometry overlay.';

export class UnavailablePhotorealisticTryOnProvider implements PhotorealisticTryOnProvider {
  readonly name = 'unavailable-photorealistic';
  readonly availability: PhotorealisticAvailability = 'unavailable';
  readonly lastError = PHOTOREALISTIC_UNAVAILABLE_REASON;

  initialize(): Promise<void> {
    return Promise.resolve();
  }

  generate(_request: PhotorealisticTryOnRequest): Promise<PhotorealisticTryOnResult | null> {
    return Promise.resolve(null);
  }

  dispose(): Promise<void> {
    return Promise.resolve();
  }
}
