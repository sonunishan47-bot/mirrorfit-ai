import type { FittingResult } from './geometry';
import { overlayPointFromLandmark } from './overlay-coordinates';
import type { CameraFrame, RenderingEngine, RenderTarget, StageTiming } from './providers';

export interface OverlayCanvas {
  width: number;
  height: number;
  getContext(id: '2d'): CanvasRenderingContext2D | null;
}

/**
 * Transparent overlay above the live video.
 *
 * Draws a garment bitmap only when a fit exists. No fit → clear canvas.
 * No bitmap → nothing is invented.
 */
export class OverlayRenderer implements RenderingEngine {
  readonly name = 'overlay-2d';
  #canvas: OverlayCanvas | null = null;
  #context: CanvasRenderingContext2D | null = null;
  #bitmap: CanvasImageSource | null = null;

  initialize(target: RenderTarget): Promise<void> {
    if (!this.#canvas) {
      throw new Error('OverlayRenderer requires attach() before initialize()');
    }
    this.resize(target);
    return Promise.resolve();
  }

  attach(canvas: OverlayCanvas): void {
    this.#canvas = canvas;
    this.#context = canvas.getContext('2d');
  }

  setOverlay(bitmap: CanvasImageSource | null): void {
    this.#bitmap = bitmap;
  }

  resize(target: RenderTarget): void {
    if (!this.#canvas) return;
    this.#canvas.width = target.width;
    this.#canvas.height = target.height;
  }

  render(frame: CameraFrame, fit: FittingResult | null): Promise<StageTiming> {
    const started = now();
    const context = this.#context;
    if (!context || !this.#canvas) {
      return Promise.resolve({ durationMs: now() - started });
    }
    context.clearRect(0, 0, this.#canvas.width, this.#canvas.height);
    if (!fit || !this.#bitmap || fit.confidence < 0.2) {
      void frame;
      return Promise.resolve({ durationMs: now() - started });
    }

    const width = this.#canvas.width;
    const height = this.#canvas.height;
    const center = overlayPointFromLandmark(fit.transform.translate);
    context.save();
    context.translate(center.x * width, center.y * height);
    context.rotate(fit.transform.rotation);
    const drawW = Math.max(fit.transform.scaleX * width, 1);
    const drawH = Math.max(fit.transform.scaleY * height, 1);
    context.drawImage(this.#bitmap, -drawW / 2, -drawH / 2, drawW, drawH);
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
    return Promise.resolve();
  }
}

export function createTestFixtureShirtBitmap(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = 200;
  canvas.height = 280;
  const context = canvas.getContext('2d');
  if (!context) return canvas;
  context.clearRect(0, 0, 200, 280);
  context.fillStyle = 'rgba(40, 90, 160, 0.35)';
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
  return canvas;
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
