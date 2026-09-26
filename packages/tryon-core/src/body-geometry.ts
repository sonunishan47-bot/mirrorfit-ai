import type { BodyGeometry, Point2D, PoseFrame } from './geometry';
import { keypointByName } from './parse-pose';
import { LANDMARK_JOINT_MIN_CONFIDENCE } from './pose-thresholds';
/** Normalized-frame floor. Below this the person is too edge-on or too far. */
export const MIN_SHOULDER_WIDTH = 0.05;
export const MIN_TORSO_HEIGHT = 0.05;

function midpoint(a: Point2D, b: Point2D): Point2D {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function distance(a: Point2D, b: Point2D): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Proportions from real landmarks, in normalized frame units.
 *
 * Returns null when the shoulders and hips are not both visible. Does not
 * invent centimetres or a facing angle: yaw is 0 unless both shoulders
 * report a finite z.
 */
export function deriveBodyGeometry(pose: PoseFrame): BodyGeometry | null {
  const leftShoulder = keypointByName(pose, 'LEFT_SHOULDER', LANDMARK_JOINT_MIN_CONFIDENCE);
  const rightShoulder = keypointByName(pose, 'RIGHT_SHOULDER', LANDMARK_JOINT_MIN_CONFIDENCE);
  const leftHip = keypointByName(pose, 'LEFT_HIP', LANDMARK_JOINT_MIN_CONFIDENCE);
  const rightHip = keypointByName(pose, 'RIGHT_HIP', LANDMARK_JOINT_MIN_CONFIDENCE);
  if (!leftShoulder || !rightShoulder || !leftHip || !rightHip) {
    return null;
  }

  const midShoulder = midpoint(leftShoulder, rightShoulder);
  const midHip = midpoint(leftHip, rightHip);
  const shoulderWidth = distance(leftShoulder, rightShoulder);
  const hipWidth = distance(leftHip, rightHip);
  const torsoHeight = distance(midShoulder, midHip);
  if (shoulderWidth < MIN_SHOULDER_WIDTH || torsoHeight < MIN_TORSO_HEIGHT) {
    return null;
  }

  const roll = Math.atan2(rightShoulder.y - leftShoulder.y, rightShoulder.x - leftShoulder.x);
  const yaw =
    leftShoulder.z !== null && rightShoulder.z !== null ? rightShoulder.z - leftShoulder.z : 0;
  const shoulderCenter = midShoulder;
  const hipCenter = midHip;
  const center = midpoint(midShoulder, midHip);

  if (
    ![
      shoulderWidth,
      torsoHeight,
      hipWidth,
      yaw,
      roll,
      shoulderCenter.x,
      shoulderCenter.y,
      hipCenter.x,
      hipCenter.y,
      center.x,
      center.y,
    ].every(Number.isFinite)
  ) {
    return null;
  }

  return {
    timestampMs: pose.timestampMs,
    shoulderWidth,
    torsoHeight,
    hipWidth,
    yaw,
    roll,
    shoulderCenter,
    hipCenter,
    center,
  };
}
