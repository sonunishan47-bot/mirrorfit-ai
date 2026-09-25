import type { PoseLandmarkName } from '@mirrorfit/types';

import type { PoseFrame } from './geometry';
import { parseKeypoint } from './parse-pose';

/**
 * MediaPipe Pose Landmarker (BlazePose) index → COCO-17 name.
 *
 * Official index list: https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker
 * Unused MediaPipe points (eyes inner/outer, mouth, hands, feet) are dropped.
 */
export const MEDIAPIPE_TO_COCO: Readonly<Record<number, PoseLandmarkName>> = {
  0: 'NOSE',
  2: 'LEFT_EYE',
  5: 'RIGHT_EYE',
  7: 'LEFT_EAR',
  8: 'RIGHT_EAR',
  11: 'LEFT_SHOULDER',
  12: 'RIGHT_SHOULDER',
  13: 'LEFT_ELBOW',
  14: 'RIGHT_ELBOW',
  15: 'LEFT_WRIST',
  16: 'RIGHT_WRIST',
  23: 'LEFT_HIP',
  24: 'RIGHT_HIP',
  25: 'LEFT_KNEE',
  26: 'RIGHT_KNEE',
  27: 'LEFT_ANKLE',
  28: 'RIGHT_ANKLE',
};

export interface MediaPipeLandmarkLike {
  readonly x: number;
  readonly y: number;
  readonly z?: number;
  readonly visibility?: number;
  readonly presence?: number;
}

/**
 * Converts official MediaPipe landmark output into our PoseFrame.
 *
 * Invalid or unmapped points are omitted. An empty result is null — no person
 * — never a fabricated skeleton.
 */
export function poseFrameFromMediaPipe(
  landmarks: readonly MediaPipeLandmarkLike[] | undefined,
  timestampMs: number,
): PoseFrame | null {
  if (!landmarks || landmarks.length === 0) return null;
  if (!Number.isFinite(timestampMs) || timestampMs < 0) return null;

  const keypoints = [];
  let visibilitySum = 0;
  let visibilityCount = 0;
  for (const [index, point] of landmarks.entries()) {
    const name = MEDIAPIPE_TO_COCO[index];
    if (!name) continue;
    const confidence =
      typeof point.visibility === 'number'
        ? point.visibility
        : typeof point.presence === 'number'
          ? point.presence
          : Number.NaN;
    const parsed = parseKeypoint({
      name,
      x: point.x,
      y: point.y,
      z: typeof point.z === 'number' ? point.z : null,
      confidence,
    });
    if (!parsed) continue;
    keypoints.push(parsed);
    visibilitySum += parsed.confidence;
    visibilityCount += 1;
  }

  if (keypoints.length === 0) return null;

  return {
    timestampMs,
    keypoints,
    confidence: visibilityCount === 0 ? 0 : visibilitySum / visibilityCount,
  };
}
