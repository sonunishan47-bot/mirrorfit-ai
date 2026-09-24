/**
 * Provider-neutral geometry types.
 *
 * Coordinates are normalized to the source frame (0..1, origin top-left) so
 * that swapping a pose model or changing camera resolution does not invalidate
 * downstream fitting code.
 */

export interface Point2D {
  readonly x: number;
  readonly y: number;
}

/**
 * COCO-17 keypoint vocabulary.
 *
 * Chosen because it is the common denominator across pose models, which keeps
 * `PoseProvider` implementations interchangeable. A richer model can expose
 * extra landmarks through its own extension type without breaking this
 * contract.
 */
export const POSE_LANDMARKS = [
  'NOSE',
  'LEFT_EYE',
  'RIGHT_EYE',
  'LEFT_EAR',
  'RIGHT_EAR',
  'LEFT_SHOULDER',
  'RIGHT_SHOULDER',
  'LEFT_ELBOW',
  'RIGHT_ELBOW',
  'LEFT_WRIST',
  'RIGHT_WRIST',
  'LEFT_HIP',
  'RIGHT_HIP',
  'LEFT_KNEE',
  'RIGHT_KNEE',
  'LEFT_ANKLE',
  'RIGHT_ANKLE',
] as const;

export type PoseLandmarkName = (typeof POSE_LANDMARKS)[number];

export interface Keypoint extends Point2D {
  readonly name: PoseLandmarkName;
  /** Metric depth is unavailable from most 2D models; null when unknown. */
  readonly z: number | null;
  readonly confidence: number;
}

export interface PoseFrame {
  /** Monotonic source timestamp in milliseconds. */
  readonly timestampMs: number;
  readonly keypoints: readonly Keypoint[];
  /** Overall detection confidence for the tracked person. */
  readonly confidence: number;
}

/**
 * Body measurements derived from pose, in normalized frame units.
 *
 * These are proportions, not centimetres. Converting to physical units needs a
 * calibration reference and is explicitly out of scope until that exists.
 */
export interface BodyGeometry {
  readonly timestampMs: number;
  readonly shoulderWidth: number;
  readonly torsoHeight: number;
  readonly hipWidth: number;
  /** Torso rotation about the vertical axis, radians, 0 when facing camera. */
  readonly yaw: number;
  /** Lean in the image plane, radians. */
  readonly roll: number;
  readonly center: Point2D;
}

/** Affine placement of a garment asset over the tracked body. */
export interface GarmentTransform {
  readonly translate: Point2D;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly rotation: number;
}

export interface FittingResult {
  readonly timestampMs: number;
  readonly transform: GarmentTransform;
  /** How much the engine trusts this fit; drives fallback behaviour. */
  readonly confidence: number;
}
