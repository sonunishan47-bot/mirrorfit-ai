import { POSE_LANDMARKS, type PoseLandmarkName } from '@mirrorfit/types';

import type { Keypoint, PoseFrame } from './geometry';

const UNIT = (value: number) => Number.isFinite(value) && value >= 0 && value <= 1;

/**
 * Accepts only a normalized pose. Invalid values are dropped, not clamped
 * into something that looks like a detection.
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
  if (!UNIT(x) || !UNIT(y) || !UNIT(confidence)) return null;
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
  if (typeof confidence !== 'number' || !UNIT(confidence)) return null;
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
