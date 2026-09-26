import type { BodyGeometry } from './geometry';
import { OCCLUSION_MIN_POSE_CONFIDENCE } from './pose-thresholds';
import type { BodyRegionMap } from './unavailable-segmentation';

export interface PoseOcclusionInput {
  readonly geometry: BodyGeometry | null;
  readonly poseConfidence: number;
  /** When segmentation is unavailable, regions are ignored — never invent a mask. */
  readonly regions?: BodyRegionMap | null;
}

export interface PoseOcclusionResult {
  /** Multiplier for overlay draw alpha in 0..1. */
  readonly overlayOpacity: number;
  /** True only when a real segmentation region contributed. */
  readonly usedSegmentation: boolean;
}

/** Raw z-delta |yaw| above this starts fading the overlay. */
export const YAW_FADE_START = 0.05;
/** Raw z-delta |yaw| at which posture fade bottoms out. */
export const YAW_FADE_END = 0.55;
/** Floor opacity when turned away — never invent a side-view garment. */
export const YAW_OPACITY_FLOOR = 0.2;
/** |roll| (radians) above this further reduces opacity. */
export const ROLL_FADE_START = Math.PI / 12;
export const ROLL_FADE_END = Math.PI / 3;

/**
 * Geometry-based overlay opacity foundation.
 *
 * When segmentation is unavailable (the current product state), opacity is
 * derived only from pose confidence, yaw, and roll. NEVER invents a person
 * mask or region alpha from missing data.
 */
export function computeOverlayOpacity(input: PoseOcclusionInput): PoseOcclusionResult {
  const confidence = clamp01(input.poseConfidence);
  if (!input.geometry || confidence < OCCLUSION_MIN_POSE_CONFIDENCE) {
    return { overlayOpacity: 0, usedSegmentation: false };
  }

  const yawFade = postureFadeFromYaw(input.geometry.yaw);
  const rollFade = postureFadeFromRoll(input.geometry.roll);
  let opacity = confidence * yawFade * rollFade;
  let usedSegmentation = false;

  const regions = input.regions;
  if (regions && regions.source === 'segmentation') {
    const torso = regions.regions.find((r) => r.region === 'TORSO' || r.region === 'UPPER_BODY');
    if (torso?.available && torso.confidence !== null && Number.isFinite(torso.confidence)) {
      opacity *= clamp01(torso.confidence);
      usedSegmentation = true;
    }
  }

  return {
    overlayOpacity: clamp01(opacity),
    usedSegmentation,
  };
}

export function postureFadeFromYaw(yaw: number): number {
  if (!Number.isFinite(yaw)) return 0;
  const abs = Math.abs(yaw);
  if (abs <= YAW_FADE_START) return 1;
  if (abs >= YAW_FADE_END) return YAW_OPACITY_FLOOR;
  const t = (abs - YAW_FADE_START) / (YAW_FADE_END - YAW_FADE_START);
  return 1 - t * (1 - YAW_OPACITY_FLOOR);
}

export function postureFadeFromRoll(roll: number): number {
  if (!Number.isFinite(roll)) return 0;
  const abs = Math.abs(roll);
  if (abs <= ROLL_FADE_START) return 1;
  if (abs >= ROLL_FADE_END) return YAW_OPACITY_FLOOR;
  const t = (abs - ROLL_FADE_START) / (ROLL_FADE_END - ROLL_FADE_START);
  return 1 - t * (1 - YAW_OPACITY_FLOOR);
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
