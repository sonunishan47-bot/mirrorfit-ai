/**
 * Pose landmark vocabulary shared by validation, the vision pipeline, and
 * tests. Coordinates are normalized to the source frame (0..1, top-left).
 *
 * COCO-17 is the common denominator across browser pose models so a
 * MediaPipe, TF.js or ONNX provider can be swapped without rewriting
 * downstream fitting.
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

export const BODY_REGIONS = ['UPPER_BODY', 'LOWER_BODY', 'ARMS', 'HANDS', 'TORSO', 'LEGS'] as const;

export type BodyRegionName = (typeof BODY_REGIONS)[number];

/**
 * Application states inside an ACTIVE session. These do not replace
 * WAITING / PAIRED / ACTIVE / ENDED.
 */
export const TRYON_RUNTIME_STATUSES = [
  'CAMERA_READY',
  'POSE_INITIALIZING',
  'POSE_READY',
  'NO_PERSON_DETECTED',
  'GARMENT_SELECTED',
  'FIT_NOT_READY',
  'FITTING',
  'PREVIEW',
  'PROVIDER_UNAVAILABLE',
] as const;

export type TryOnRuntimeStatus = (typeof TRYON_RUNTIME_STATUSES)[number];

export const TRYON_PROVIDER_AVAILABILITIES = ['ready', 'unavailable', 'initializing'] as const;
export type TryOnProviderAvailability = (typeof TRYON_PROVIDER_AVAILABILITIES)[number];
