import type { BodyGeometry, Point2D } from './geometry';
import type { LowerBodyGeometry } from './lower-body-geometry';

export type { LowerBodyGeometry } from './lower-body-geometry';

/**
 * Normalized parallelogram for pose-driven overlay warping.
 *
 * STATUS: geometry warp of a PNG/WebP asset — NOT photorealistic cloth
 * simulation and NOT diffusion try-on. Improves body alignment using real
 * shoulder/hip landmarks only.
 */
export interface WarpParallelogram {
  readonly topLeft: Point2D;
  readonly topRight: Point2D;
  readonly bottomRight: Point2D;
  readonly bottomLeft: Point2D;
}

/**
 * Builds a torso parallelogram from measured shoulder/hip geometry.
 * Returns null when dimensions are non-finite or collapsed.
 */
export function torsoWarpParallelogram(
  geometry: BodyGeometry,
  widthFactor = 1.35,
): WarpParallelogram | null {
  if (
    ![
      geometry.shoulderWidth,
      geometry.hipWidth,
      geometry.torsoHeight,
      geometry.roll,
      geometry.shoulderCenter.x,
      geometry.shoulderCenter.y,
      geometry.hipCenter.x,
      geometry.hipCenter.y,
    ].every(Number.isFinite)
  ) {
    return null;
  }
  if (geometry.shoulderWidth <= 0 || geometry.torsoHeight <= 0) return null;

  const topHalf = (geometry.shoulderWidth * widthFactor) / 2;
  const bottomHalf = (Math.max(geometry.hipWidth, geometry.shoulderWidth * 0.85) * widthFactor) / 2;
  const topLeft = offsetAlongRoll(geometry.shoulderCenter, geometry.roll, -topHalf);
  const topRight = offsetAlongRoll(geometry.shoulderCenter, geometry.roll, topHalf);
  const bottomLeft = offsetAlongRoll(geometry.hipCenter, geometry.roll, -bottomHalf);
  const bottomRight = offsetAlongRoll(geometry.hipCenter, geometry.roll, bottomHalf);

  if (![topLeft, topRight, bottomRight, bottomLeft].every(pointFinite)) return null;
  return { topLeft, topRight, bottomRight, bottomLeft };
}

/**
 * Builds a lower-body parallelogram from hip → foot geometry.
 */
export function lowerBodyWarpParallelogram(
  geometry: LowerBodyGeometry,
  widthFactor = 1.25,
): WarpParallelogram | null {
  if (
    ![
      geometry.hipWidth,
      geometry.legLength,
      geometry.hipRoll,
      geometry.hipCenter.x,
      geometry.hipCenter.y,
      geometry.footCenter.x,
      geometry.footCenter.y,
    ].every(Number.isFinite)
  ) {
    return null;
  }
  if (geometry.hipWidth <= 0 || geometry.legLength <= 0) return null;

  const half = (geometry.hipWidth * widthFactor) / 2;
  const ankleHalf = half * 0.72;
  const topLeft = offsetAlongRoll(geometry.hipCenter, geometry.hipRoll, -half);
  const topRight = offsetAlongRoll(geometry.hipCenter, geometry.hipRoll, half);
  const bottomLeft = offsetAlongRoll(geometry.footCenter, geometry.hipRoll, -ankleHalf);
  const bottomRight = offsetAlongRoll(geometry.footCenter, geometry.hipRoll, ankleHalf);
  if (![topLeft, topRight, bottomRight, bottomLeft].every(pointFinite)) return null;
  return { topLeft, topRight, bottomRight, bottomLeft };
}

/**
 * Draws `bitmap` into a normalized-frame parallelogram on a pixel canvas.
 * Uses a three-point affine map (TL, TR, BL). Returns false when degenerate.
 *
 * The canvas transform maps the unit square (0,0)–(1,1) onto the
 * parallelogram. Destination size for `drawImage` MUST be 1×1 in that
 * space — using the pixel edge lengths (w×h) double-scales the garment
 * off-screen (physical kiosk: geometry ready, warp “succeeds”, nothing visible).
 */
export function drawImageInParallelogram(
  context: CanvasRenderingContext2D,
  bitmap: CanvasImageSource,
  quad: WarpParallelogram,
  canvasWidth: number,
  canvasHeight: number,
  opacity = 1,
): boolean {
  if (canvasWidth <= 0 || canvasHeight <= 0) return false;
  const source = bitmapSourceSize(bitmap);
  if (!source) return false;

  const tl = toPx(quad.topLeft, canvasWidth, canvasHeight);
  const tr = toPx(quad.topRight, canvasWidth, canvasHeight);
  const bl = toPx(quad.bottomLeft, canvasWidth, canvasHeight);
  const br = toPx(quad.bottomRight, canvasWidth, canvasHeight);

  const topEdgeX = tr.x - tl.x;
  const topEdgeY = tr.y - tl.y;
  const leftEdgeX = bl.x - tl.x;
  const leftEdgeY = bl.y - tl.y;
  const w = Math.hypot(topEdgeX, topEdgeY);
  const h = Math.hypot(leftEdgeX, leftEdgeY);
  if (w < 1 || h < 1) return false;
  if (![topEdgeX, topEdgeY, leftEdgeX, leftEdgeY].every(Number.isFinite)) return false;

  // Sanity: opposite corner should be near tl + (tr-tl) + (bl-tl).
  void br;

  const alpha = Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 1;
  context.save();
  context.globalAlpha = alpha;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  // Unit square → parallelogram. Do not bake w/h into drawImage destination.
  context.setTransform(topEdgeX, topEdgeY, leftEdgeX, leftEdgeY, tl.x, tl.y);
  context.drawImage(bitmap, 0, 0, source.width, source.height, 0, 0, 1, 1);
  context.restore();
  return true;
}

function bitmapSourceSize(
  bitmap: CanvasImageSource,
): { readonly width: number; readonly height: number } | null {
  if ('naturalWidth' in bitmap && 'naturalHeight' in bitmap) {
    const width = Number(bitmap.naturalWidth);
    const height = Number(bitmap.naturalHeight);
    if (width > 0 && height > 0) return { width, height };
  }
  if ('videoWidth' in bitmap && 'videoHeight' in bitmap) {
    const width = Number(bitmap.videoWidth);
    const height = Number(bitmap.videoHeight);
    if (width > 0 && height > 0) return { width, height };
  }
  if ('width' in bitmap && 'height' in bitmap) {
    const width = Number(bitmap.width);
    const height = Number(bitmap.height);
    if (width > 0 && height > 0) return { width, height };
  }
  return null;
}

function offsetAlongRoll(center: Point2D, roll: number, signedHalfWidth: number): Point2D {
  return {
    x: center.x + Math.cos(roll) * signedHalfWidth,
    y: center.y + Math.sin(roll) * signedHalfWidth,
  };
}

function toPx(point: Point2D, width: number, height: number): Point2D {
  return { x: point.x * width, y: point.y * height };
}

function pointFinite(point: Point2D): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}
