import type { BodyGeometry, FittingResult, PoseFrame } from './geometry';
import { deriveBodyGeometry } from './body-geometry';
import { resolveFitCategory } from './fit-category';
import type { FittingInput, GarmentFittingEngine } from './providers';

export interface GarmentFitRequest {
  readonly garmentId: string;
  readonly variantId: string;
  readonly category?: string | null;
}

export type FitStatus = 'ready' | 'not_ready' | 'lower_body_not_implemented';

/** Shirt is slightly wider than the clavicle line. Applied to measured width. */
export const TOP_WIDTH_FACTOR = 1.35;
/** Shirt hangs a little past the hip line. Applied to measured torso height. */
export const TOP_HEIGHT_FACTOR = 1.1;
/** Overlay center sits this fraction of torso height below the shoulders. */
export const TOP_VERTICAL_OFFSET = 0.38;
export const MIN_POSE_CONFIDENCE = 0.2;
/** Reject a body that is rolled so far the shirt would be edge-on. */
export const MAX_ABS_ROLL = Math.PI / 3;

/**
 * Deterministic 2D placement from pose landmarks.
 *
 * STATUS: geometry foundation only. Not photorealistic try-on. A missing
 * pose or unloaded garment yields null, never a decorative overlay.
 */
export class LandmarkFittingEngine implements GarmentFittingEngine {
  readonly name = 'landmark-geometry';
  #garment: GarmentFitRequest | null = null;

  initialize(): Promise<void> {
    return Promise.resolve();
  }

  #lastStatus: FitStatus = 'not_ready';

  get lastStatus(): FitStatus {
    return this.#lastStatus;
  }

  loadGarment(garmentId: string, variantId: string, category?: string | null): Promise<void> {
    if (!garmentId || !variantId) {
      throw new Error('Garment ids are required');
    }
    this.#garment = {
      garmentId,
      variantId,
      ...(category === undefined ? {} : { category }),
    };
    return Promise.resolve();
  }

  clearGarment(): void {
    this.#garment = null;
  }

  get loadedGarment(): GarmentFitRequest | null {
    return this.#garment;
  }

  fit(input: FittingInput): Promise<FittingResult | null> {
    const result = fitFromPose(input.pose, input.geometry, this.#garment);
    this.#lastStatus = result.status;
    return Promise.resolve(result.fit);
  }

  dispose(): Promise<void> {
    this.#garment = null;
    return Promise.resolve();
  }
}

export function fitFromPose(
  pose: PoseFrame,
  geometry: BodyGeometry | null = deriveBodyGeometry(pose),
  garment: GarmentFitRequest | null,
): { fit: FittingResult | null; status: FitStatus } {
  if (!garment) return { fit: null, status: 'not_ready' };
  // Do not invent a TOP category when the catalog left category unset.
  const family = resolveFitCategory(garment.category);
  if (family === 'LOWER_BODY') {
    return { fit: null, status: 'lower_body_not_implemented' };
  }
  if (family === null) return { fit: null, status: 'not_ready' };
  if (!geometry || pose.confidence < MIN_POSE_CONFIDENCE) {
    return { fit: null, status: 'not_ready' };
  }
  if (
    !Number.isFinite(geometry.roll) ||
    !Number.isFinite(geometry.shoulderWidth) ||
    !Number.isFinite(geometry.torsoHeight) ||
    !Number.isFinite(geometry.shoulderCenter.x) ||
    !Number.isFinite(geometry.shoulderCenter.y) ||
    Math.abs(geometry.roll) > MAX_ABS_ROLL
  ) {
    return { fit: null, status: 'not_ready' };
  }

  return {
    status: 'ready',
    fit: {
      timestampMs: pose.timestampMs,
      transform: {
        translate: {
          x: geometry.shoulderCenter.x,
          y: geometry.shoulderCenter.y + geometry.torsoHeight * TOP_VERTICAL_OFFSET,
        },
        scaleX: geometry.shoulderWidth * TOP_WIDTH_FACTOR,
        scaleY: geometry.torsoHeight * TOP_HEIGHT_FACTOR,
        rotation: geometry.roll,
      },
      confidence: Math.min(pose.confidence, 1),
    },
  };
}
