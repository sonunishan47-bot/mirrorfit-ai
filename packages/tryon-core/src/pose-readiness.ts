import type { PoseFrame } from './geometry';
import { keypointByName } from './parse-pose';

const MIN_CONFIDENCE = 0.35;

export interface PoseReadiness {
  readonly landmarkCount: number;
  readonly shouldersReady: boolean;
  readonly hipsReady: boolean;
  readonly geometryReady: boolean;
}

/**
 * Counts validated landmarks and whether TOP-fitting joints are present.
 *
 * Does not invent missing joints. Does not include coordinates — this is
 * for the kiosk acceptance line, not a biometric record.
 */
export function describePoseReadiness(pose: PoseFrame | null): PoseReadiness {
  if (!pose) {
    return {
      landmarkCount: 0,
      shouldersReady: false,
      hipsReady: false,
      geometryReady: false,
    };
  }
  const leftShoulder = keypointByName(pose, 'LEFT_SHOULDER', MIN_CONFIDENCE);
  const rightShoulder = keypointByName(pose, 'RIGHT_SHOULDER', MIN_CONFIDENCE);
  const leftHip = keypointByName(pose, 'LEFT_HIP', MIN_CONFIDENCE);
  const rightHip = keypointByName(pose, 'RIGHT_HIP', MIN_CONFIDENCE);
  const shouldersReady = Boolean(leftShoulder && rightShoulder);
  const hipsReady = Boolean(leftHip && rightHip);
  return {
    landmarkCount: pose.keypoints.length,
    shouldersReady,
    hipsReady,
    geometryReady: shouldersReady && hipsReady,
  };
}

export function formatPoseReadiness(readiness: PoseReadiness): string {
  if (readiness.landmarkCount === 0) {
    return 'No landmarks this frame.';
  }
  return `Landmarks ${readiness.landmarkCount}. Shoulders ${readiness.shouldersReady ? 'ready' : 'missing'}. Hips ${readiness.hipsReady ? 'ready' : 'missing'}.`;
}
