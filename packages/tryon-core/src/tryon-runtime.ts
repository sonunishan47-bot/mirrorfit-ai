import type { TryOnRuntimeStatus } from '@mirrorfit/types';

export const TRYON_RUNTIME_EVENTS = [
  'CAMERA_LIVE',
  'POSE_START',
  'POSE_READY',
  'PROVIDER_MISSING',
  'PERSON_SEEN',
  'PERSON_LOST',
  'GARMENT_CHOSEN',
  'GARMENT_CLEARED',
  'FIT_READY',
  'FIT_NOT_READY',
  'FIT_LOST',
  'RESET',
] as const;

export type TryOnRuntimeEvent = (typeof TRYON_RUNTIME_EVENTS)[number];

const TRANSITIONS: Readonly<
  Record<TryOnRuntimeStatus, Partial<Record<TryOnRuntimeEvent, TryOnRuntimeStatus>>>
> = {
  CAMERA_READY: {
    POSE_START: 'POSE_INITIALIZING',
    PROVIDER_MISSING: 'PROVIDER_UNAVAILABLE',
    RESET: 'CAMERA_READY',
  },
  POSE_INITIALIZING: {
    POSE_READY: 'POSE_READY',
    PROVIDER_MISSING: 'PROVIDER_UNAVAILABLE',
    RESET: 'CAMERA_READY',
  },
  POSE_READY: {
    PERSON_LOST: 'NO_PERSON_DETECTED',
    GARMENT_CHOSEN: 'GARMENT_SELECTED',
    PROVIDER_MISSING: 'PROVIDER_UNAVAILABLE',
    RESET: 'CAMERA_READY',
  },
  NO_PERSON_DETECTED: {
    PERSON_SEEN: 'POSE_READY',
    GARMENT_CHOSEN: 'NO_PERSON_DETECTED',
    GARMENT_CLEARED: 'NO_PERSON_DETECTED',
    PROVIDER_MISSING: 'PROVIDER_UNAVAILABLE',
    RESET: 'CAMERA_READY',
  },
  GARMENT_SELECTED: {
    PERSON_LOST: 'NO_PERSON_DETECTED',
    FIT_READY: 'FITTING',
    FIT_NOT_READY: 'FIT_NOT_READY',
    GARMENT_CLEARED: 'POSE_READY',
    PROVIDER_MISSING: 'PROVIDER_UNAVAILABLE',
    RESET: 'CAMERA_READY',
  },
  FIT_NOT_READY: {
    PERSON_LOST: 'NO_PERSON_DETECTED',
    FIT_READY: 'FITTING',
    GARMENT_CLEARED: 'POSE_READY',
    GARMENT_CHOSEN: 'GARMENT_SELECTED',
    PROVIDER_MISSING: 'PROVIDER_UNAVAILABLE',
    RESET: 'CAMERA_READY',
  },
  FITTING: {
    FIT_READY: 'PREVIEW',
    FIT_NOT_READY: 'FIT_NOT_READY',
    FIT_LOST: 'GARMENT_SELECTED',
    PERSON_LOST: 'NO_PERSON_DETECTED',
    GARMENT_CLEARED: 'POSE_READY',
    PROVIDER_MISSING: 'PROVIDER_UNAVAILABLE',
    RESET: 'CAMERA_READY',
  },
  PREVIEW: {
    FIT_LOST: 'GARMENT_SELECTED',
    FIT_NOT_READY: 'FIT_NOT_READY',
    PERSON_LOST: 'NO_PERSON_DETECTED',
    GARMENT_CLEARED: 'POSE_READY',
    GARMENT_CHOSEN: 'GARMENT_SELECTED',
    PROVIDER_MISSING: 'PROVIDER_UNAVAILABLE',
    RESET: 'CAMERA_READY',
  },
  PROVIDER_UNAVAILABLE: {
    GARMENT_CHOSEN: 'PROVIDER_UNAVAILABLE',
    GARMENT_CLEARED: 'PROVIDER_UNAVAILABLE',
    RESET: 'CAMERA_READY',
  },
};

export function reduceTryOn(
  status: TryOnRuntimeStatus,
  event: TryOnRuntimeEvent,
): TryOnRuntimeStatus {
  return TRANSITIONS[status][event] ?? status;
}

export function presentTryOn(status: TryOnRuntimeStatus): {
  readonly status: TryOnRuntimeStatus;
  readonly label: string;
  readonly honesty: string;
} {
  switch (status) {
    case 'CAMERA_READY':
      return {
        status,
        label: 'Camera ready',
        honesty: 'Local camera only. Pose estimation has not started.',
      };
    case 'POSE_INITIALIZING':
      return {
        status,
        label: 'Starting pose provider',
        honesty: 'Loading the official MediaPipe Pose Landmarker. No garment is fitted yet.',
      };
    case 'POSE_READY':
      return {
        status,
        label: 'POSE READY',
        honesty: 'Landmarks are local to this kiosk. This is not photorealistic try-on.',
      };
    case 'NO_PERSON_DETECTED':
      return {
        status,
        label: 'NO PERSON DETECTED',
        honesty: 'The pose model did not find a body in this frame. Nothing is invented.',
      };
    case 'GARMENT_SELECTED':
      return {
        status,
        label: 'Garment selected',
        honesty: 'Waiting for a usable pose before placing the overlay.',
      };
    case 'FIT_NOT_READY':
      return {
        status,
        label: 'FIT NOT READY',
        honesty: 'Shoulders and hips are not confident enough, or this category is not implemented.',
      };
    case 'FITTING':
      return {
        status,
        label: 'Fitting from pose',
        honesty: 'Placement uses detected landmarks. This is not photorealistic try-on.',
      };
    case 'PREVIEW':
      return {
        status,
        label: 'Pose + fitting',
        honesty: 'Overlay uses pose geometry. Segmentation is not applied.',
      };
    case 'PROVIDER_UNAVAILABLE':
      return {
        status,
        label: 'POSE PROVIDER UNAVAILABLE',
        honesty:
          'No pose model is running. The pose provider did not initialize. The camera preview is unchanged.',
      };
  }
}
