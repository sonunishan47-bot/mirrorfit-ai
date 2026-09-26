/**
 * STATUS: PROVIDER UNAVAILABLE — NOT PRODUCTION READY.
 *
 * Photorealistic / diffusion try-on is not integrated. Reasons:
 * 1. No verified on-device appearance-preserving model ships in this repo.
 * 2. Cloud diffusion would require uploading camera frames, which violates
 *    the privacy invariant unless an explicit consent path exists (it does not).
 *
 * Callers must fall back to local pose-geometry / pose-warp overlays.
 * This module never invents a fake "AI ready" image.
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
