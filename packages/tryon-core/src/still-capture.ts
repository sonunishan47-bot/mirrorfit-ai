import { MIN_POSE_CONFIDENCE } from './pose-thresholds';

/** Longest edge of the single still sent for optional photorealistic try-on. */
export const STILL_LONG_EDGE_PX = 1280;

/** JPEG encoder quality for that still. Not a video stream. */
export const STILL_JPEG_QUALITY = 0.85;

/** Reject tiny or accidental payloads before they are stored. */
export const STILL_MIN_BYTES = 1024;

/** Hard cap. A 1280px JPEG of one person is far below this. */
export const STILL_MAX_BYTES = 2_000_000;

export const PHOTO_TRYON_POLICY_VERSION = 'photo-tryon-upload-1';

/** UI wait for one still inference. The live overlay is not blocked on this. */
export const PHOTOREALISTIC_QUEUE_TIMEOUT_MS = 20_000;

export type StillRejectReason =
  'NO_PERSON' | 'BODY_NOT_VISIBLE' | 'SESSION_INACTIVE' | 'NO_GARMENT';

export function scaledStillSize(
  width: number,
  height: number,
  longEdge = STILL_LONG_EDGE_PX,
): { readonly width: number; readonly height: number } | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 2 || height < 2) {
    return null;
  }
  if (!Number.isFinite(longEdge) || longEdge < 2) return null;
  const scale = longEdge / Math.max(width, height);
  const nextWidth = Math.max(2, Math.round(width * Math.min(1, scale)));
  const nextHeight = Math.max(2, Math.round(height * Math.min(1, scale)));
  return { width: nextWidth, height: nextHeight };
}

export function stillCaptureDecision(input: {
  readonly personDetected: boolean;
  readonly bodyConfidence: number | null;
  readonly sessionActive: boolean;
  readonly garmentSelected: boolean;
}): { readonly ok: true } | { readonly ok: false; readonly reason: StillRejectReason } {
  if (!input.sessionActive) return { ok: false, reason: 'SESSION_INACTIVE' };
  if (!input.garmentSelected) return { ok: false, reason: 'NO_GARMENT' };
  if (!input.personDetected) return { ok: false, reason: 'NO_PERSON' };
  if (
    input.bodyConfidence === null ||
    !Number.isFinite(input.bodyConfidence) ||
    input.bodyConfidence < MIN_POSE_CONFIDENCE
  ) {
    return { ok: false, reason: 'BODY_NOT_VISIBLE' };
  }
  return { ok: true };
}

/** JPEG SOI marker. Does not decode the image. */
export function isJpegPayload(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

export function validateStillJpeg(
  bytes: Uint8Array,
):
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'EMPTY' | 'TOO_SMALL' | 'TOO_LARGE' | 'NOT_JPEG' } {
  if (bytes.byteLength === 0) return { ok: false, reason: 'EMPTY' };
  if (bytes.byteLength < STILL_MIN_BYTES) return { ok: false, reason: 'TOO_SMALL' };
  if (bytes.byteLength > STILL_MAX_BYTES) return { ok: false, reason: 'TOO_LARGE' };
  if (!isJpegPayload(bytes)) return { ok: false, reason: 'NOT_JPEG' };
  return { ok: true };
}
