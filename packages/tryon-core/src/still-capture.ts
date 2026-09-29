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

/** Smallest side we will store. Rejects padded headers that are not a picture. */
export const STILL_MIN_EDGE_PX = 64;

/** Largest side. A 1280px still is far below this; it blocks decompression bombs. */
export const STILL_MAX_EDGE_PX = 4096;

/**
 * Reads width and height from a JPEG SOF marker.
 * Does not decode pixels and does not accept a header with no frame.
 */
export function jpegDimensions(
  bytes: Uint8Array,
): { readonly width: number; readonly height: number } | null {
  if (!isJpegPayload(bytes)) return null;
  let index = 2;
  while (index < bytes.length) {
    if (bytes[index] !== 0xff) return null;
    index += 1;
    while (index < bytes.length && bytes[index] === 0xff) index += 1;
    if (index >= bytes.length) return null;
    const marker = bytes[index] ?? 0;
    index += 1;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (marker === 0xd9 || marker === 0xda) return null;
    if (index + 1 >= bytes.length) return null;
    const length = ((bytes[index] ?? 0) << 8) | (bytes[index + 1] ?? 0);
    if (length < 2 || index + length > bytes.length) return null;
    const sof =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (sof) {
      if (length < 7) return null;
      const height = ((bytes[index + 3] ?? 0) << 8) | (bytes[index + 4] ?? 0);
      const width = ((bytes[index + 5] ?? 0) << 8) | (bytes[index + 6] ?? 0);
      if (width <= 0 || height <= 0) return null;
      return { width, height };
    }
    index += length;
  }
  return null;
}

export function validateStillDimensions(
  bytes: Uint8Array,
):
  | { readonly ok: true; readonly width: number; readonly height: number }
  | { readonly ok: false; readonly reason: 'UNREADABLE' | 'TOO_SMALL_EDGE' | 'TOO_LARGE_EDGE' } {
  const size = jpegDimensions(bytes);
  if (!size) return { ok: false, reason: 'UNREADABLE' };
  const longEdge = Math.max(size.width, size.height);
  const shortEdge = Math.min(size.width, size.height);
  if (shortEdge < STILL_MIN_EDGE_PX) return { ok: false, reason: 'TOO_SMALL_EDGE' };
  if (longEdge > STILL_MAX_EDGE_PX) return { ok: false, reason: 'TOO_LARGE_EDGE' };
  return { ok: true, width: size.width, height: size.height };
}

/**
 * Rejects panorama strips and slivers. A 1280×720 laptop still is allowed.
 * This does not judge beauty or invent a replacement.
 */
export function validateStillFraming(
  width: number,
  height: number,
): { readonly ok: true } | { readonly ok: false; readonly reason: 'BAD_ASPECT' } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { ok: false, reason: 'BAD_ASPECT' };
  }
  const ratio = width / height;
  if (ratio < 0.4 || ratio > 2.2) return { ok: false, reason: 'BAD_ASPECT' };
  return { ok: true };
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
