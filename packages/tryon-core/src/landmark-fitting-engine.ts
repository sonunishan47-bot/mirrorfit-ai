import type { GarmentFitCategory } from '@mirrorfit/types';

import type { BodyGeometry, FittingResult, PoseFrame } from './geometry';
import { deriveBodyGeometry } from './body-geometry';
import { resolveFitCategory } from './fit-category';
import { deriveLowerBodyGeometry } from './lower-body-geometry';
import { keypointByName } from './parse-pose';
import {
  FIT_HOLD_CONFIDENCE_DECAY,
  FIT_HOLD_MAX_FRAMES,
  MIN_POSE_CONFIDENCE,
  OVERLAY_MIN_DRAW_CONFIDENCE,
} from './pose-thresholds';
import type { FittingInput, GarmentFittingEngine } from './providers';

export {
  FIT_HOLD_CONFIDENCE_DECAY,
  FIT_HOLD_MAX_FRAMES,
  MIN_POSE_CONFIDENCE,
  OVERLAY_MIN_DRAW_CONFIDENCE,
} from './pose-thresholds';

export interface GarmentFitRequest {
  readonly garmentId: string;
  readonly variantId: string;
  readonly category?: string | null;
}

/**
 * `lower_body_not_implemented` is retained for callers that still branch on it,
 * but LandmarkFittingEngine now fits LOWER_BODY from hip/knee/ankle geometry.
 * Prefer checking `ready` / `not_ready` for new code.
 */
export type FitStatus = 'ready' | 'not_ready' | 'lower_body_not_implemented';

/** Shirt is slightly wider than the clavicle line. Applied to measured width. */
export const TOP_WIDTH_FACTOR = 1.35;
/** Shirt hangs a little past the hip line when no asset aspect is available. */
export const TOP_HEIGHT_FACTOR = 1.1;
/**
 * When the overlay pivot is the geometric center, drop the draw origin this
 * fraction of torso height below the shoulders. Unused for shoulder-anchored
 * commercial overlays (anchor carries the shoulder line).
 */
export const TOP_VERTICAL_OFFSET = 0.38;
/** Pants slightly wider than measured hip line. */
export const LOWER_WIDTH_FACTOR = 1.25;
/** Leg length factor when no asset aspect is available. */
export const LOWER_HEIGHT_FACTOR = 1.05;
/** Reject a body that is rolled so far the garment would be edge-on. */
export const MAX_ABS_ROLL = Math.PI / 3;
/** Light EMA toward new samples — reduces jitter without inventing pose. */
export const FIT_SMOOTHING_ALPHA = 0.35; // was 0.45 — smoother on noisy laptop cams
/** Translate tracks a bit faster than scale to reduce lag on lateral moves. */
export const FIT_TRANSLATE_ALPHA = 0.42; // was 0.55
export const FIT_SCALE_ALPHA = 0.32; // was 0.4
export const FIT_ROTATION_ALPHA = 0.28; // was 0.35
/**
 * Blend of hip width into draw width (0 = shoulders only). Keeps tops from
 * pinching at the waist when hips are wider — still geometry, not invention.
 */
export const DEFAULT_HIP_WIDTH_BLEND = 0.12;
/** Raw |yaw| (shoulder z delta) at which scaleX compression starts. */
export const YAW_SCALE_START = 0.04;
/** Raw |yaw| where scaleX compression bottoms out. */
export const YAW_SCALE_END = 0.5;
/** Floor for yaw scaleX multiplier — never invent a full-width side view. */
export const YAW_SCALE_FLOOR = 0.55;

export type AnchorMode = 'center' | 'shoulders' | 'hips';
/** @deprecated Prefer AnchorMode. */
export type TopAnchorMode = AnchorMode;

export interface FitSmoothingAlphas {
  readonly translate?: number;
  readonly scale?: number;
  readonly rotation?: number;
}

export interface FitFromPoseOptions {
  readonly anchorMode?: AnchorMode;
  readonly previous?: FittingResult | null;
  /** Uniform alpha when separate alphas are not provided. */
  readonly smoothingAlpha?: number;
  readonly smoothing?: FitSmoothingAlphas;
  /** Optional override for family width factor (e.g. jacket / jeans defaults). */
  readonly widthFactor?: number;
  /** Optional hip→shoulder width blend in 0..1 (TOP only). */
  readonly hipWidthBlend?: number;
}

/**
 * Deterministic 2D placement from pose landmarks.
 *
 * STATUS: geometry foundation + pose-warp inputs. Not photorealistic try-on.
 * A missing pose or unloaded garment yields null, never a decorative overlay.
 */
export class LandmarkFittingEngine implements GarmentFittingEngine {
  readonly name = 'landmark-geometry';
  #garment: GarmentFitRequest | null = null;
  #anchorMode: AnchorMode = 'center';
  #previousFit: FittingResult | null = null;
  /** Consecutive frames without a fresh fit — used for overlay hold/hysteresis. */
  #missStreak = 0;
  #widthFactor: number | null = null;
  #hipWidthBlend: number | null = null;

  initialize(): Promise<void> {
    return Promise.resolve();
  }

  #lastStatus: FitStatus = 'not_ready';

  get lastStatus(): FitStatus {
    return this.#lastStatus;
  }

  #resetHold(): void {
    this.#previousFit = null;
    this.#missStreak = 0;
  }

  setAnchorMode(mode: AnchorMode): void {
    this.#anchorMode = mode;
    this.#resetHold();
  }

  /** Category-aware width hint; null restores family default factor. */
  setWidthFactor(factor: number | null): void {
    this.#widthFactor =
      typeof factor === 'number' && Number.isFinite(factor) && factor > 0 ? factor : null;
    this.#resetHold();
  }

  /** Optional hip blend into draw width (TOP); null uses DEFAULT_HIP_WIDTH_BLEND. */
  setHipWidthBlend(blend: number | null): void {
    this.#hipWidthBlend =
      typeof blend === 'number' && Number.isFinite(blend) ? Math.min(1, Math.max(0, blend)) : null;
    this.#resetHold();
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
    this.#resetHold();
    return Promise.resolve();
  }

  clearGarment(): void {
    this.#garment = null;
    this.#resetHold();
  }

  /**
   * Drop any held overlay immediately (person lost / camera stop).
   * Does not invent a new pose — only clears the hysteresis buffer.
   */
  clearHeldFit(): void {
    this.#resetHold();
    this.#lastStatus = 'not_ready';
  }

  get loadedGarment(): GarmentFitRequest | null {
    return this.#garment;
  }

  fit(input: FittingInput): Promise<FittingResult | null> {
    const result = fitFromPose(input.pose, input.geometry, this.#garment, {
      anchorMode: this.#anchorMode,
      previous: this.#previousFit,
      ...(this.#widthFactor === null ? {} : { widthFactor: this.#widthFactor }),
      ...(this.#hipWidthBlend === null ? {} : { hipWidthBlend: this.#hipWidthBlend }),
    });

    if (result.fit) {
      this.#missStreak = 0;
      this.#previousFit = result.fit;
      this.#lastStatus = result.status;
      return Promise.resolve(result.fit);
    }

    // Brief miss after a good fit → hold last transform so the shirt does not flicker off
    // on weak laptop-camera frames. Confidence decays; never invents a new pose.
    if (this.#previousFit && this.#missStreak < FIT_HOLD_MAX_FRAMES) {
      this.#missStreak += 1;
      const decayed = Math.max(
        OVERLAY_MIN_DRAW_CONFIDENCE,
        this.#previousFit.confidence * Math.pow(FIT_HOLD_CONFIDENCE_DECAY, this.#missStreak),
      );
      const held: FittingResult = {
        timestampMs: input.pose.timestampMs,
        confidence: decayed,
        transform: this.#previousFit.transform,
      };
      this.#previousFit = held;
      this.#lastStatus = 'ready';
      return Promise.resolve(held);
    }

    this.#resetHold();
    this.#lastStatus = result.status;
    return Promise.resolve(null);
  }

  dispose(): Promise<void> {
    this.#garment = null;
    this.#resetHold();
    this.#widthFactor = null;
    this.#hipWidthBlend = null;
    return Promise.resolve();
  }
}

export function fitFromPose(
  pose: PoseFrame,
  geometry: BodyGeometry | null = deriveBodyGeometry(pose),
  garment: GarmentFitRequest | null,
  options?: FitFromPoseOptions,
): { fit: FittingResult | null; status: FitStatus } {
  if (!garment) return { fit: null, status: 'not_ready' };
  const family = resolveFitCategory(garment.category);
  if (family !== 'TOP' && family !== 'LOWER_BODY' && family !== 'FULL_BODY') {
    return { fit: null, status: 'not_ready' };
  }
  // Use joints required for this family — not the mean of every mapped
  // landmark. Low-visibility ankles/wrists were diluting pose.confidence
  // below MIN_POSE_CONFIDENCE even when shoulders+hips were ready.
  const jointConfidence = fittingJointConfidence(pose, family);
  if (jointConfidence < MIN_POSE_CONFIDENCE) {
    return { fit: null, status: 'not_ready' };
  }

  if (family === 'LOWER_BODY') {
    return fitLowerBodyFromPose(pose, garment, options, jointConfidence);
  }

  if (family === 'FULL_BODY') {
    return fitTopFromPose(pose, geometry, options, jointConfidence);
  }

  return fitTopFromPose(pose, geometry, options, jointConfidence);
}

function fitTopFromPose(
  pose: PoseFrame,
  geometry: BodyGeometry | null,
  options: FitFromPoseOptions | undefined,
  jointConfidence: number,
): { fit: FittingResult | null; status: FitStatus } {
  if (!geometry) {
    return { fit: null, status: 'not_ready' };
  }
  if (
    !Number.isFinite(geometry.roll) ||
    !Number.isFinite(geometry.shoulderWidth) ||
    !Number.isFinite(geometry.torsoHeight) ||
    !Number.isFinite(geometry.shoulderCenter.x) ||
    !Number.isFinite(geometry.shoulderCenter.y) ||
    !Number.isFinite(geometry.yaw) ||
    !Number.isFinite(geometry.hipWidth) ||
    Math.abs(geometry.roll) > MAX_ABS_ROLL
  ) {
    return { fit: null, status: 'not_ready' };
  }

  const anchorMode = options?.anchorMode ?? 'center';
  const translateY =
    anchorMode === 'shoulders'
      ? geometry.shoulderCenter.y
      : geometry.shoulderCenter.y + geometry.torsoHeight * TOP_VERTICAL_OFFSET;

  const widthFactor =
    typeof options?.widthFactor === 'number' &&
    Number.isFinite(options.widthFactor) &&
    options.widthFactor > 0
      ? options.widthFactor
      : TOP_WIDTH_FACTOR;

  const hipBlend =
    typeof options?.hipWidthBlend === 'number' && Number.isFinite(options.hipWidthBlend)
      ? Math.min(1, Math.max(0, options.hipWidthBlend))
      : DEFAULT_HIP_WIDTH_BLEND;

  const blendedWidth = geometry.shoulderWidth * (1 - hipBlend) + geometry.hipWidth * hipBlend;
  const yawScale = yawScaleCompression(geometry.yaw);

  const raw: FittingResult = {
    timestampMs: pose.timestampMs,
    transform: {
      translate: {
        x: geometry.shoulderCenter.x,
        y: translateY,
      },
      scaleX: blendedWidth * widthFactor * yawScale,
      scaleY: geometry.torsoHeight * TOP_HEIGHT_FACTOR,
      rotation: geometry.roll,
    },
    confidence: Math.min(jointConfidence, 1),
  };

  const fit = smoothFit(raw, options?.previous ?? null, resolveSmoothing(options));
  return { status: 'ready', fit };
}

function fitLowerBodyFromPose(
  pose: PoseFrame,
  _garment: GarmentFitRequest,
  options: FitFromPoseOptions | undefined,
  jointConfidence: number,
): { fit: FittingResult | null; status: FitStatus } {
  const lower = deriveLowerBodyGeometry(pose);
  if (!lower) {
    return { fit: null, status: 'not_ready' };
  }
  if (
    !Number.isFinite(lower.hipRoll) ||
    !Number.isFinite(lower.hipWidth) ||
    !Number.isFinite(lower.legLength) ||
    Math.abs(lower.hipRoll) > MAX_ABS_ROLL
  ) {
    return { fit: null, status: 'not_ready' };
  }

  const widthFactor =
    typeof options?.widthFactor === 'number' &&
    Number.isFinite(options.widthFactor) &&
    options.widthFactor > 0
      ? options.widthFactor
      : LOWER_WIDTH_FACTOR;

  const raw: FittingResult = {
    timestampMs: pose.timestampMs,
    transform: {
      translate: {
        x: lower.hipCenter.x,
        y: lower.hipCenter.y,
      },
      scaleX: lower.hipWidth * widthFactor,
      scaleY: lower.legLength * LOWER_HEIGHT_FACTOR,
      rotation: lower.hipRoll,
    },
    confidence: Math.min(jointConfidence, 1),
  };

  const fit = smoothFit(raw, options?.previous ?? null, resolveSmoothing(options));
  return { status: 'ready', fit };
}

/**
 * Minimum confidence among joints required for the active fit family.
 * Missing joints yield 0 — callers treat that as not ready.
 */
export function fittingJointConfidence(pose: PoseFrame, family: GarmentFitCategory): number {
  if (family === 'TOP') {
    const joints = [
      keypointByName(pose, 'LEFT_SHOULDER'),
      keypointByName(pose, 'RIGHT_SHOULDER'),
      keypointByName(pose, 'LEFT_HIP'),
      keypointByName(pose, 'RIGHT_HIP'),
    ];
    if (joints.some((joint) => joint === null)) return 0;
    return Math.min(...joints.map((joint) => joint!.confidence));
  }
  if (family === 'FULL_BODY') {
    return fittingJointConfidence(pose, 'TOP');
  }
  if (family === 'LOWER_BODY') {
    const hips = [keypointByName(pose, 'LEFT_HIP'), keypointByName(pose, 'RIGHT_HIP')];
    if (hips.some((joint) => joint === null)) return 0;
    const distal = [
      keypointByName(pose, 'LEFT_ANKLE'),
      keypointByName(pose, 'RIGHT_ANKLE'),
      keypointByName(pose, 'LEFT_KNEE'),
      keypointByName(pose, 'RIGHT_KNEE'),
    ].filter((joint): joint is NonNullable<typeof joint> => joint !== null);
    if (distal.length < 2) return 0;
    return Math.min(
      hips[0]!.confidence,
      hips[1]!.confidence,
      ...distal.map((joint) => joint.confidence),
    );
  }
  return 0;
}

/**
 * Compress scaleX from real shoulder z-delta yaw. Front-facing (yaw≈0) keeps
 * full width; turned poses shrink honestly without inventing a side silhouette.
 */
export function yawScaleCompression(yaw: number): number {
  if (!Number.isFinite(yaw)) return YAW_SCALE_FLOOR;
  const abs = Math.abs(yaw);
  if (abs <= YAW_SCALE_START) return 1;
  if (abs >= YAW_SCALE_END) return YAW_SCALE_FLOOR;
  const t = (abs - YAW_SCALE_START) / (YAW_SCALE_END - YAW_SCALE_START);
  return 1 - t * (1 - YAW_SCALE_FLOOR);
}

function resolveSmoothing(options?: FitFromPoseOptions): FitSmoothingAlphas {
  if (options?.smoothing) return options.smoothing;
  if (typeof options?.smoothingAlpha === 'number') {
    const a = options.smoothingAlpha;
    return { translate: a, scale: a, rotation: a };
  }
  return {
    translate: FIT_TRANSLATE_ALPHA,
    scale: FIT_SCALE_ALPHA,
    rotation: FIT_ROTATION_ALPHA,
  };
}

function smoothFit(
  next: FittingResult,
  previous: FittingResult | null,
  alphas: FitSmoothingAlphas,
): FittingResult {
  if (!previous) return next;
  const clampA = (value: number | undefined, fallback: number) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
    return Math.min(1, Math.max(0, value));
  };
  const at = clampA(alphas.translate, FIT_TRANSLATE_ALPHA);
  const as = clampA(alphas.scale, FIT_SCALE_ALPHA);
  const ar = clampA(alphas.rotation, FIT_ROTATION_ALPHA);
  const mix = (from: number, to: number, a: number) => from * (1 - a) + to * a;
  return {
    timestampMs: next.timestampMs,
    confidence: next.confidence,
    transform: {
      translate: {
        x: mix(previous.transform.translate.x, next.transform.translate.x, at),
        y: mix(previous.transform.translate.y, next.transform.translate.y, at),
      },
      scaleX: mix(previous.transform.scaleX, next.transform.scaleX, as),
      scaleY: mix(previous.transform.scaleY, next.transform.scaleY, as),
      rotation: mix(previous.transform.rotation, next.transform.rotation, ar),
    },
  };
}
