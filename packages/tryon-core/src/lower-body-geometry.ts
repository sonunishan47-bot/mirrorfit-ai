import type { Point2D, PoseFrame } from './geometry';
import { keypointByName } from './parse-pose';
import { LANDMARK_JOINT_MIN_CONFIDENCE } from './pose-thresholds';
export const MIN_HIP_WIDTH = 0.04;
export const MIN_LEG_LENGTH = 0.08;

export interface LowerBodyGeometry {
  readonly timestampMs: number;
  readonly hipWidth: number;
  readonly legLength: number;
  readonly hipRoll: number;
  readonly hipCenter: Point2D;
  readonly footCenter: Point2D;
}

function midpoint(a: Point2D, b: Point2D): Point2D {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function distance(a: Point2D, b: Point2D): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Lower-body proportions from real hip + ankle (or knee) landmarks.
 *
 * Prefers ankles for leg length; falls back to knees when ankles are missing.
 * Returns null when hips or a distal pair are not confident â€” never invents
 * pant length.
 */
export function deriveLowerBodyGeometry(pose: PoseFrame): LowerBodyGeometry | null {
  const leftHip = keypointByName(pose, 'LEFT_HIP', LANDMARK_JOINT_MIN_CONFIDENCE);
  const rightHip = keypointByName(pose, 'RIGHT_HIP', LANDMARK_JOINT_MIN_CONFIDENCE);
  if (!leftHip || !rightHip) return null;

  const leftAnkle = keypointByName(pose, 'LEFT_ANKLE', LANDMARK_JOINT_MIN_CONFIDENCE);
  const rightAnkle = keypointByName(pose, 'RIGHT_ANKLE', LANDMARK_JOINT_MIN_CONFIDENCE);
  const leftKnee = keypointByName(pose, 'LEFT_KNEE', LANDMARK_JOINT_MIN_CONFIDENCE);
  const rightKnee = keypointByName(pose, 'RIGHT_KNEE', LANDMARK_JOINT_MIN_CONFIDENCE);

  let footLeft = leftAnkle;
  let footRight = rightAnkle;
  if (!footLeft || !footRight) {
    footLeft = leftKnee;
    footRight = rightKnee;
  }
  if (!footLeft || !footRight) return null;

  const hipCenter = midpoint(leftHip, rightHip);
  const footCenter = midpoint(footLeft, footRight);
  const hipWidth = distance(leftHip, rightHip);
  const legLength = distance(hipCenter, footCenter);
  if (hipWidth < MIN_HIP_WIDTH || legLength < MIN_LEG_LENGTH) return null;

  const hipRoll = Math.atan2(rightHip.y - leftHip.y, rightHip.x - leftHip.x);
  if (
    ![hipWidth, legLength, hipRoll, hipCenter.x, hipCenter.y, footCenter.x, footCenter.y].every(
      Number.isFinite,
    )
  ) {
    return null;
  }

  return {
    timestampMs: pose.timestampMs,
    hipWidth,
    legLength,
    hipRoll,
    hipCenter,
    footCenter,
  };
}
