/**
 * Store delayed try-on. Local Lucy Edit Dev only.
 * These are config values, not a claim that the weights are installed.
 */

export type LucyVramProfileName = 'gpu_8gb' | 'gpu_12gb' | 'gpu_16gb_plus';

export interface LucyVramProfile {
  readonly name: LucyVramProfileName;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly frames: number;
  readonly steps: number;
}

/** 12s rolling buffer. The exported window is the last 6s, inside 5–10s. */
export const LUCY_BUFFER_SECONDS = 12;
export const LUCY_EXPORT_SECONDS = 6;
export const LUCY_MIN_CLIP_MS = 5_000;

/**
 * Heights are multiples of 32. 640x360 is stored as 640x352.
 * 720p is stored as 1280x704. gpu_8gb is the 480p / fewer-frame budget;
 * start ComfyUI with --lowvram on that card. The graph still loads the FP16 UNET.
 */

export const LUCY_VRAM_PROFILES: Readonly<Record<LucyVramProfileName, LucyVramProfile>> = {
  gpu_8gb: { name: 'gpu_8gb', width: 640, height: 480, fps: 12, frames: 17, steps: 8 },
  gpu_12gb: { name: 'gpu_12gb', width: 640, height: 352, fps: 16, frames: 25, steps: 10 },
  gpu_16gb_plus: {
    name: 'gpu_16gb_plus',
    width: 1280,
    height: 704,
    fps: 16,
    frames: 33,
    steps: 12,
  },
};

export function readLucyVramProfile(env: {
  readonly LUCY_VRAM_PROFILE?: string | undefined;
}): LucyVramProfile {
  const name = env.LUCY_VRAM_PROFILE?.trim();
  if (name === 'gpu_8gb' || name === 'gpu_16gb_plus' || name === 'gpu_12gb') {
    return LUCY_VRAM_PROFILES[name];
  }
  return LUCY_VRAM_PROFILES.gpu_12gb;
}

/** Seconds into a finished segment where the exported window starts. */
export function clipStartSeconds(
  durationMs: number,
  exportSeconds = LUCY_EXPORT_SECONDS,
): number | null {
  if (!Number.isFinite(durationMs) || durationMs < LUCY_MIN_CLIP_MS) return null;
  return Math.max(0, durationMs / 1000 - exportSeconds);
}
