import type { FittingResult } from './geometry';
import { overlayPointFromLandmark } from './overlay-coordinates';
import { OVERLAY_MIN_DRAW_CONFIDENCE } from './pose-thresholds';
import { postureFadeFromYaw } from './pose-occlusion';
import { drawImageInParallelogram, type WarpParallelogram } from './pose-warp';
import type { CameraFrame, RenderingEngine, RenderTarget, StageTiming } from './providers';

export interface OverlayCanvas {
  width: number;
  height: number;
  getContext(id: '2d', options?: CanvasRenderingContext2DSettings): CanvasRenderingContext2D | null;
}

/** Normalized pivot inside the garment bitmap (0..1). Shoulders ≈ y 0.2–0.35. */
export interface OverlayAnchor {
  readonly x: number;
  readonly y: number;
}

export interface OverlayLayout {
  readonly anchor: OverlayAnchor;
  /** When set, height is derived from draw width to preserve asset proportions. */
  readonly aspectRatio: number | null;
}

export interface OverlayRenderOptions {
  /**
   * Explicit draw opacity 0..1 (e.g. from pose-occlusion). When omitted,
   * opacity is derived from fit.confidence and optional yaw.
   */
  readonly opacity?: number;
  /**
   * Raw shoulder z-delta yaw for posture fade when opacity is not supplied.
   * Geometry-based — not an invented segmentation mask.
   */
  readonly yaw?: number;
  /**
   * Optional pose-warp parallelogram. When present and valid, the bitmap is
   * drawn with an affine map into that quad instead of rotation+scale around
   * the fit translate. STATUS: geometry warp — NOT photorealistic cloth / AI.
   */
  readonly warp?: WarpParallelogram | null;
}

export const DEFAULT_OVERLAY_LAYOUT: OverlayLayout = {
  anchor: { x: 0.5, y: 0.5 },
  aspectRatio: null,
};

/**
 * Transparent overlay above the live video.
 *
 * Draws a garment bitmap only when a fit exists. No fit → clear canvas.
 * No bitmap → nothing is invented.
 *
 * Anchor places the asset pivot on the pose translate point (shoulder / hip
 * line). Aspect ratio keeps commercial PNG/WebP proportions when set.
 * Optional pose-warp uses a landmark parallelogram for body-aligned draw.
 * Draw alpha comes from fit confidence and posture (|yaw|), optionally
 * overridden by an explicit opacity from pose-occlusion.
 */
export class OverlayRenderer implements RenderingEngine {
  readonly name = 'overlay-2d';
  #canvas: OverlayCanvas | null = null;
  #context: CanvasRenderingContext2D | null = null;
  #bitmap: CanvasImageSource | null = null;
  #layout: OverlayLayout = DEFAULT_OVERLAY_LAYOUT;

  initialize(target: RenderTarget): Promise<void> {
    if (!this.#canvas) {
      throw new Error('OverlayRenderer requires attach() before initialize()');
    }
    this.resize(target);
    return Promise.resolve();
  }

  attach(canvas: OverlayCanvas): void {
    this.#canvas = canvas;
    // Explicit alpha so the garment layer never composites as an opaque black plate
    // over the live camera (fullscreen portal host on the kiosk).
    this.#context = canvas.getContext('2d', { alpha: true });
  }

  setOverlay(bitmap: CanvasImageSource | null, layout?: Partial<OverlayLayout> | null): void {
    this.#bitmap = bitmap;
    if (!bitmap) {
      this.#layout = DEFAULT_OVERLAY_LAYOUT;
      return;
    }
    const anchor = layout?.anchor ?? DEFAULT_OVERLAY_LAYOUT.anchor;
    const aspectRatio =
      layout && 'aspectRatio' in layout ? layout.aspectRatio : DEFAULT_OVERLAY_LAYOUT.aspectRatio;
    this.#layout = {
      anchor: sanitizeAnchor(anchor),
      aspectRatio:
        typeof aspectRatio === 'number' && Number.isFinite(aspectRatio) && aspectRatio > 0
          ? aspectRatio
          : null,
    };
  }

  resize(target: RenderTarget): void {
    if (!this.#canvas) return;
    this.#canvas.width = target.width;
    this.#canvas.height = target.height;
  }

  render(
    frame: CameraFrame,
    fit: FittingResult | null,
    options?: OverlayRenderOptions,
  ): Promise<StageTiming> {
    const started = now();
    const context = this.#context;
    if (!context || !this.#canvas) {
      return Promise.resolve({ durationMs: now() - started });
    }
    context.clearRect(0, 0, this.#canvas.width, this.#canvas.height);
    if (!fit || !this.#bitmap || fit.confidence < OVERLAY_MIN_DRAW_CONFIDENCE) {
      void frame;
      return Promise.resolve({ durationMs: now() - started });
    }

    const width = this.#canvas.width;
    const height = this.#canvas.height;
    const alpha = resolveDrawAlpha(fit.confidence, options);
    const warp = options?.warp ?? null;

    if (warp) {
      const warped = drawImageInParallelogram(context, this.#bitmap, warp, width, height, alpha);
      if (warped) {
        return Promise.resolve({ durationMs: now() - started });
      }
      // Degenerate warp → fall back to shoulder/hip-anchored affine draw.
    }

    const center = overlayPointFromLandmark(fit.transform.translate);
    const drawW = Math.max(fit.transform.scaleX * width, 1);
    const drawH = Math.max(
      this.#layout.aspectRatio ? drawW / this.#layout.aspectRatio : fit.transform.scaleY * height,
      1,
    );
    const anchor = this.#layout.anchor;

    context.save();
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.globalAlpha = alpha;
    context.translate(center.x * width, center.y * height);
    context.rotate(fit.transform.rotation);
    context.drawImage(this.#bitmap, -anchor.x * drawW, -anchor.y * drawH, drawW, drawH);
    context.restore();
    return Promise.resolve({ durationMs: now() - started });
  }

  dispose(): Promise<void> {
    if (this.#context && this.#canvas) {
      this.#context.clearRect(0, 0, this.#canvas.width, this.#canvas.height);
    }
    this.#context = null;
    this.#canvas = null;
    this.#bitmap = null;
    this.#layout = DEFAULT_OVERLAY_LAYOUT;
    return Promise.resolve();
  }
}

export function createTestFixtureShirtBitmap(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 200;
  canvas.height = 280;
  const context = canvas.getContext('2d');
  if (context) {
    context.clearRect(0, 0, 200, 280);
    context.fillStyle = 'rgba(40, 90, 160, 0.55)';
    context.beginPath();
    context.moveTo(40, 40);
    context.lineTo(70, 40);
    context.lineTo(80, 20);
    context.lineTo(120, 20);
    context.lineTo(130, 40);
    context.lineTo(160, 40);
    context.lineTo(175, 90);
    context.lineTo(145, 90);
    context.lineTo(145, 250);
    context.lineTo(55, 250);
    context.lineTo(55, 90);
    context.lineTo(25, 90);
    context.closePath();
    context.fill();
    context.strokeStyle = 'rgba(40, 90, 160, 0.8)';
    context.stroke();
    context.fillStyle = 'rgba(20, 40, 80, 0.85)';
    context.font = '12px sans-serif';
    context.textAlign = 'center';
    context.fillText('TEST FIXTURE', 100, 140);
    context.fillText('NOT A PRODUCT', 100, 158);
  }
  return canvas;
}

/** Labelled pants fixture for LOWER_BODY — not a commercial product image. */
export function createTestFixturePantsBitmap(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 180;
  canvas.height = 320;
  const context = canvas.getContext('2d');
  if (context) {
    context.clearRect(0, 0, 180, 320);
    context.fillStyle = 'rgba(50, 70, 110, 0.6)';
    context.beginPath();
    context.moveTo(40, 20);
    context.lineTo(140, 20);
    context.lineTo(150, 70);
    context.lineTo(155, 300);
    context.lineTo(105, 300);
    context.lineTo(100, 120);
    context.lineTo(80, 120);
    context.lineTo(75, 300);
    context.lineTo(25, 300);
    context.lineTo(30, 70);
    context.closePath();
    context.fill();
    context.strokeStyle = 'rgba(40, 55, 90, 0.85)';
    context.stroke();
    context.fillStyle = 'rgba(20, 30, 50, 0.9)';
    context.font = '11px sans-serif';
    context.textAlign = 'center';
    context.fillText('TEST FIXTURE', 90, 160);
    context.fillText('PANTS — NOT A PRODUCT', 90, 176);
  }
  return canvas;
}

/** Shoulder line in the procedural fixture bitmap (~y=40 of 280). */
export const TEST_FIXTURE_OVERLAY_LAYOUT: OverlayLayout = {
  anchor: { x: 0.5, y: 40 / 280 },
  aspectRatio: 200 / 280,
};

/** Waistband line in the procedural pants fixture (~y=20 of 320). */
export const TEST_FIXTURE_PANTS_LAYOUT: OverlayLayout = {
  anchor: { x: 0.5, y: 20 / 320 },
  aspectRatio: 180 / 320,
};

export function resolveDrawAlpha(confidence: number, options?: OverlayRenderOptions): number {
  const conf = Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0;
  if (typeof options?.opacity === 'number' && Number.isFinite(options.opacity)) {
    return Math.min(1, Math.max(0, options.opacity));
  }
  const yaw = typeof options?.yaw === 'number' && Number.isFinite(options.yaw) ? options.yaw : 0;
  return Math.min(1, Math.max(0, conf * postureFadeFromYaw(yaw)));
}

function sanitizeAnchor(anchor: OverlayAnchor): OverlayAnchor {
  const x = Number.isFinite(anchor.x) ? Math.min(1, Math.max(0, anchor.x)) : 0.5;
  const y = Number.isFinite(anchor.y) ? Math.min(1, Math.max(0, anchor.y)) : 0.5;
  return { x, y };
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
