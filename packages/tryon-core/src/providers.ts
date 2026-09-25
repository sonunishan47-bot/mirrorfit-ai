import type { BodyGeometry, FittingResult, PoseFrame } from './geometry';

/**
 * Stage contracts for the live fitting pipeline.
 *
 * ---------------------------------------------------------------------------
 * STATUS: contracts for the live pipeline. Pose is implemented by
 * MediaPipePoseProvider (web). Segmentation remains UnavailableSegmentationProvider.
 * ---------------------------------------------------------------------------
 *
 * Nothing in this file performs computer vision. These are the seams that let
 * each stage be built, benchmarked and replaced independently:
 *
 *   CameraProvider
 *     -> PoseProvider
 *     -> SegmentationProvider
 *     -> DepthProvider
 *     -> BodyGeometry
 *     -> GarmentFittingEngine
 *     -> RenderingEngine
 *
 * Every stage is async-capable and reports its own timing, because the only
 * way to know whether the 30 FPS floor is met is to measure each stage rather
 * than the pipeline as a whole.
 */

export interface StageTiming {
  /** Wall-clock duration of the stage for one frame. */
  readonly durationMs: number;
}

export interface Disposable {
  dispose(): Promise<void>;
}

export interface CameraFrame {
  readonly timestampMs: number;
  readonly width: number;
  readonly height: number;
  /**
   * The decoded frame. Kept as a browser image source so downstream stages can
   * upload straight to the GPU without a CPU copy.
   */
  readonly source: CanvasImageSource;
}

export interface CameraConstraints {
  readonly width: number;
  readonly height: number;
  readonly frameRate: number;
  readonly deviceId?: string;
}

/** Owns the camera stream. Raw frames must never leave the device. */
export interface CameraProvider extends Disposable {
  start(constraints: CameraConstraints): Promise<void>;
  stop(): Promise<void>;
  /** Latest frame, or null before the first frame arrives. */
  readFrame(): CameraFrame | null;
  readonly isRunning: boolean;
}

export interface PoseProvider extends Disposable {
  initialize(): Promise<void>;
  estimate(frame: CameraFrame): Promise<PoseFrame | null>;
  /** Same contract as `estimate`. Kept so a pipeline can say processFrame. */
  processFrame(frame: CameraFrame): Promise<PoseFrame | null>;
  readonly name: string;
  readonly availability: 'ready' | 'unavailable' | 'initializing';
  readonly lastError?: string | null;
}

/** Person/background separation, used for correct garment layering. */
export interface SegmentationMask {
  readonly timestampMs: number;
  readonly width: number;
  readonly height: number;
  /** Single-channel coverage, 0 = background, 255 = person. */
  readonly data: Uint8ClampedArray;
}

export interface SegmentationProvider extends Disposable {
  initialize(): Promise<void>;
  segment(frame: CameraFrame): Promise<SegmentationMask | null>;
  readonly name: string;
  readonly availability: 'ready' | 'unavailable' | 'initializing';
  readonly lastError?: string | null;
}

export interface DepthMap {
  readonly timestampMs: number;
  readonly width: number;
  readonly height: number;
  /** Relative depth, near = 0. Not metric unless the provider says so. */
  readonly data: Float32Array;
  readonly isMetric: boolean;
}

/** Enables arms-in-front-of-garment occlusion. */
export interface DepthProvider extends Disposable {
  initialize(): Promise<void>;
  estimate(frame: CameraFrame): Promise<DepthMap | null>;
  readonly name: string;
}

export interface FittingInput {
  readonly pose: PoseFrame;
  readonly geometry: BodyGeometry;
  readonly segmentation: SegmentationMask | null;
  readonly depth: DepthMap | null;
}

/**
 * Maps body geometry onto a garment asset.
 *
 * Implementations are expected to advance through the quality levels set out
 * in the product spec (pose-aware 2D, then occlusion-aware, then mesh
 * deformation), each one benchmarked against the previous.
 */
export interface GarmentFittingEngine extends Disposable {
  initialize(): Promise<void>;
  /** Loads and prepares garment assets; resolves once the garment can render. */
  loadGarment(garmentId: string, variantId: string): Promise<void>;
  fit(input: FittingInput): Promise<FittingResult | null>;
  readonly name: string;
}

export interface RenderTarget {
  readonly width: number;
  readonly height: number;
}

export interface RenderingEngine extends Disposable {
  initialize(target: RenderTarget): Promise<void>;
  render(frame: CameraFrame, fit: FittingResult | null): Promise<StageTiming>;
  resize(target: RenderTarget): void;
  readonly name: string;
}
