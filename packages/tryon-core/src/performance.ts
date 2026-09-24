/**
 * Performance measurement for the live fitting pipeline.
 *
 * Every number reported by this module comes from an actual observation. There
 * are no synthetic or assumed values: an unmeasured metric reports `null`
 * rather than a plausible-looking default, because a fabricated frame time is
 * worse than a missing one when tuning a real installation.
 */

export const PIPELINE_METRICS = [
  'camera_fps',
  'processing_fps',
  'render_fps',
  'frame_total_ms',
  'pose_inference_ms',
  'segmentation_ms',
  'depth_ms',
  'fitting_ms',
  'render_ms',
  'garment_swap_ms',
  'realtime_message_ms',
] as const;

export type PipelineMetric = (typeof PIPELINE_METRICS)[number];

export interface MetricStats {
  readonly count: number;
  readonly min: number;
  readonly max: number;
  readonly mean: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly last: number;
}

/**
 * Fixed-capacity ring buffer of samples.
 *
 * Bounded on purpose: a mirror runs for a full retail day at 30-60 FPS, so an
 * unbounded history would grow without limit and skew percentiles toward
 * long-past conditions.
 */
export class RollingWindow {
  readonly #samples: number[] = [];
  readonly #capacity: number;
  #writeIndex = 0;

  constructor(capacity = 300) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError('capacity must be a positive integer');
    }
    this.#capacity = capacity;
  }

  get capacity(): number {
    return this.#capacity;
  }

  get count(): number {
    return this.#samples.length;
  }

  push(value: number): void {
    if (!Number.isFinite(value)) {
      throw new RangeError('metric samples must be finite');
    }
    if (this.#samples.length < this.#capacity) {
      this.#samples.push(value);
      return;
    }
    this.#samples[this.#writeIndex] = value;
    this.#writeIndex = (this.#writeIndex + 1) % this.#capacity;
  }

  /** Most recently pushed sample, or null when empty. */
  get last(): number | null {
    if (this.#samples.length === 0) return null;
    const index =
      this.#samples.length < this.#capacity
        ? this.#samples.length - 1
        : (this.#writeIndex - 1 + this.#capacity) % this.#capacity;
    return this.#samples[index] ?? null;
  }

  /** Nearest-rank percentile. `p` is 0..100. */
  percentile(p: number): number | null {
    if (p < 0 || p > 100) throw new RangeError('percentile must be between 0 and 100');
    if (this.#samples.length === 0) return null;
    const sorted = [...this.#samples].sort((a, b) => a - b);
    const rank = Math.ceil((p / 100) * sorted.length);
    const index = Math.min(Math.max(rank - 1, 0), sorted.length - 1);
    return sorted[index] ?? null;
  }

  stats(): MetricStats | null {
    if (this.#samples.length === 0) return null;
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    let sum = 0;
    for (const sample of this.#samples) {
      if (sample < min) min = sample;
      if (sample > max) max = sample;
      sum += sample;
    }
    return {
      count: this.#samples.length,
      min,
      max,
      mean: sum / this.#samples.length,
      p50: this.percentile(50) ?? 0,
      p95: this.percentile(95) ?? 0,
      p99: this.percentile(99) ?? 0,
      last: this.last ?? 0,
    };
  }

  reset(): void {
    this.#samples.length = 0;
    this.#writeIndex = 0;
  }
}

/**
 * Frame rate derived from observed frame timestamps.
 *
 * Measuring the interval between real frames catches dropped frames, which a
 * counter incremented once per second does not.
 */
export class FrameRateCounter {
  readonly #timestamps: number[] = [];
  readonly #capacity: number;

  constructor(capacity = 120) {
    if (!Number.isInteger(capacity) || capacity < 2) {
      throw new RangeError('capacity must be an integer of at least 2');
    }
    this.#capacity = capacity;
  }

  tick(timestampMs: number): void {
    if (!Number.isFinite(timestampMs)) {
      throw new RangeError('timestamp must be finite');
    }
    this.#timestamps.push(timestampMs);
    if (this.#timestamps.length > this.#capacity) {
      this.#timestamps.shift();
    }
  }

  /** Frames per second across the window, or null before two frames. */
  fps(): number | null {
    if (this.#timestamps.length < 2) return null;
    const first = this.#timestamps[0];
    const last = this.#timestamps[this.#timestamps.length - 1];
    if (first === undefined || last === undefined) return null;
    const elapsedMs = last - first;
    if (elapsedMs <= 0) return null;
    return ((this.#timestamps.length - 1) / elapsedMs) * 1000;
  }

  reset(): void {
    this.#timestamps.length = 0;
  }
}

export type PerformanceSnapshot = Readonly<Record<PipelineMetric, MetricStats | null>>;

/** Collects samples for every pipeline metric. */
export class PerformanceRegistry {
  readonly #windows = new Map<PipelineMetric, RollingWindow>();
  readonly #capacity: number;

  constructor(capacity = 300) {
    this.#capacity = capacity;
  }

  record(metric: PipelineMetric, value: number): void {
    let window = this.#windows.get(metric);
    if (!window) {
      window = new RollingWindow(this.#capacity);
      this.#windows.set(metric, window);
    }
    window.push(value);
  }

  /** Times `fn` and records the elapsed duration under `metric`. */
  async time<T>(metric: PipelineMetric, fn: () => Promise<T>, clock = defaultClock): Promise<T> {
    const start = clock();
    try {
      return await fn();
    } finally {
      this.record(metric, clock() - start);
    }
  }

  stats(metric: PipelineMetric): MetricStats | null {
    return this.#windows.get(metric)?.stats() ?? null;
  }

  snapshot(): PerformanceSnapshot {
    const entries = PIPELINE_METRICS.map(
      (metric) =>
        [metric, this.stats(metric)] as const satisfies readonly [
          PipelineMetric,
          MetricStats | null,
        ],
    );
    return Object.fromEntries(entries) as PerformanceSnapshot;
  }

  reset(): void {
    this.#windows.clear();
  }
}

function defaultClock(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/**
 * Engineering targets from the product specification.
 *
 * Kept in code so a build can assert against them rather than relying on
 * someone remembering the numbers.
 */
export const PERFORMANCE_TARGETS = {
  /** Below this the experience is no longer acceptable in a store. */
  minimumFps: 30,
  /** Target on hardware with a capable discrete GPU. */
  targetFps: 60,
  /** p95 from GARMENT_SELECTED to first rendered frame, asset already cached. */
  garmentSwapP95Ms: 250,
} as const;

export interface TargetEvaluation {
  readonly metric: PipelineMetric;
  readonly target: number;
  readonly observed: number | null;
  readonly meetsTarget: boolean | null;
}

/** Compares a snapshot against the published targets. Null means unmeasured. */
export function evaluateTargets(snapshot: PerformanceSnapshot): readonly TargetEvaluation[] {
  const renderFps = snapshot.render_fps;
  const swap = snapshot.garment_swap_ms;
  return [
    {
      metric: 'render_fps',
      target: PERFORMANCE_TARGETS.minimumFps,
      observed: renderFps?.p50 ?? null,
      meetsTarget: renderFps ? renderFps.p50 >= PERFORMANCE_TARGETS.minimumFps : null,
    },
    {
      metric: 'garment_swap_ms',
      target: PERFORMANCE_TARGETS.garmentSwapP95Ms,
      observed: swap?.p95 ?? null,
      meetsTarget: swap ? swap.p95 <= PERFORMANCE_TARGETS.garmentSwapP95Ms : null,
    },
  ];
}
