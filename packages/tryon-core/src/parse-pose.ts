import { POSE_LANDMARKS, type PoseLandmarkName } from '@mirrorfit/types';

import type { Keypoint, PoseFrame } from './geometry';

const UNIT_CONFIDENCE = (value: number) => Number.isFinite(value) && value >= 0 && value <= 1;

/**
 * MediaPipe Pose Landmarker may report joints slightly outside the unit
 * square when a limb is near or past the frame edge. Those are still real
 * detections — rejecting them made kiosk TOP fitting report "Hips missing"
 * whenever the customer stood close to the glass. Non-finite or wildly
 * out-of-frame values are still dropped (never clamped into a fake joint).
 */
export const LANDMARK_COORD_MIN = -0.5;
export const LANDMARK_COORD_MAX = 1.5;

const FINITE_LANDMARK_COORD = (value: number) =>
  Number.isFinite(value) && value >= LANDMARK_COORD_MIN && value <= LANDMARK_COORD_MAX;

/**
 * Accepts a MediaPipe-shaped landmark. Invalid values are dropped, not
 * clamped into something that looks like a detection.
 */
export function parseKeypoint(input: unknown): Keypoint | null {
  if (!input || typeof input !== 'object') return null;
  const row = input as Record<string, unknown>;
  if (!POSE_LANDMARKS.includes(row['name'] as PoseLandmarkName)) return null;
  const x = row['x'];
  const y = row['y'];
  const confidence = row['confidence'];
  const z = row['z'];
  if (typeof x !== 'number' || typeof y !== 'number' || typeof confidence !== 'number') {
    return null;
  }
  if (!FINITE_LANDMARK_COORD(x) || !FINITE_LANDMARK_COORD(y) || !UNIT_CONFIDENCE(confidence)) {
    return null;
  }
  if (z !== null && z !== undefined && (typeof z !== 'number' || !Number.isFinite(z))) {
    return null;
  }
  return {
    name: row['name'] as PoseLandmarkName,
    x,
    y,
    z: typeof z === 'number' ? z : null,
    confidence,
  };
}

export function parsePoseFrame(input: unknown): PoseFrame | null {
  if (!input || typeof input !== 'object') return null;
  const row = input as Record<string, unknown>;
  const timestampMs = row['timestampMs'];
  const confidence = row['confidence'];
  if (typeof timestampMs !== 'number' || !Number.isFinite(timestampMs) || timestampMs < 0) {
    return null;
  }
  if (typeof confidence !== 'number' || !UNIT_CONFIDENCE(confidence)) return null;
  if (!Array.isArray(row['keypoints'])) return null;

  const seen = new Set<PoseLandmarkName>();
  const keypoints: Keypoint[] = [];
  for (const item of row['keypoints']) {
    const keypoint = parseKeypoint(item);
    if (!keypoint) return null;
    if (seen.has(keypoint.name)) return null;
    seen.add(keypoint.name);
    keypoints.push(keypoint);
  }

  return { timestampMs, keypoints, confidence };
}

export function keypointByName(
  frame: PoseFrame,
  name: PoseLandmarkName,
  minConfidence = 0,
): Keypoint | null {
  const found = frame.keypoints.find((point) => point.name === name) ?? null;
  if (!found || found.confidence < minConfidence) return null;
  return found;
}
