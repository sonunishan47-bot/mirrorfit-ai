import type { CameraFrame } from './providers';

export interface FramePipelinePorts {
  readonly readFrame: () => CameraFrame | null;
  readonly process: (frame: CameraFrame) => Promise<void>;
  readonly now?: () => number;
  readonly schedule?: (callback: () => void) => number;
  readonly cancel?: (handle: number) => void;
}

/**
 * Consumes the latest local camera frame at a capped rate.
 *
 * Latest-frame-only: if a process call is still in flight, the next tick
 * drops rather than queueing. Frames are passed by reference; this module
 * never copies pixels or sends them anywhere.
 */
export class CameraFramePipeline {
  readonly #ports: Required<Pick<FramePipelinePorts, 'now' | 'schedule' | 'cancel'>> &
    FramePipelinePorts;
  readonly #minIntervalMs: number;
  #running = false;
  #inFlight = false;
  #generation = 0;
  #handle = 0;
  #lastStartMs = 0;
  #droppedWhileBusy = 0;
  /** Soft ceiling so a week-long kiosk session cannot grow the counter without bound. */
  static readonly MAX_DROPPED_REPORT = 1_000_000;

  constructor(ports: FramePipelinePorts, maxFps = 8) {
    if (!Number.isFinite(maxFps) || maxFps <= 0 || maxFps > 60) {
      throw new RangeError('maxFps must be in (0, 60]');
    }
    this.#minIntervalMs = 1000 / maxFps;
    this.#ports = {
      ...ports,
      now: ports.now ?? defaultNow,
      schedule: ports.schedule ?? defaultSchedule,
      cancel: ports.cancel ?? defaultCancel,
    };
  }

  get isRunning(): boolean {
    return this.#running;
  }

  /** Frames that arrived while a previous process() was still running. */
  get droppedWhileBusy(): number {
    return this.#droppedWhileBusy;
  }

  start(): void {
    if (this.#running) return;
    this.#running = true;
    this.#generation += 1;
    this.#droppedWhileBusy = 0;
    this.#lastStartMs = Number.NEGATIVE_INFINITY;
    this.#arm();
  }

  stop(): void {
    this.#running = false;
    this.#generation += 1;
    this.#ports.cancel(this.#handle);
    this.#handle = 0;
  }

  dispose(): Promise<void> {
    this.stop();
    return Promise.resolve();
  }

  #arm(): void {
    if (!this.#running) return;
    this.#handle = this.#ports.schedule(() => {
      void this.#tick();
    });
  }

  #tick(): Promise<void> {
    if (!this.#running) return Promise.resolve();
    const generation = this.#generation;
    const now = this.#ports.now();
    const due = now - this.#lastStartMs >= this.#minIntervalMs;
    if (due && this.#inFlight) {
      if (this.#droppedWhileBusy < CameraFramePipeline.MAX_DROPPED_REPORT) {
        this.#droppedWhileBusy += 1;
      }
    } else if (due && !this.#inFlight) {
      const frame = this.#ports.readFrame();
      if (frame) {
        this.#lastStartMs = now;
        this.#inFlight = true;
        void this.#ports
          .process(frame)
          .catch(() => {
            // A single frame failure is not a pipeline crash.
          })
          .finally(() => {
            this.#inFlight = false;
          });
      }
    }
    if (generation === this.#generation && this.#running) {
      this.#arm();
    }
    return Promise.resolve();
  }
}

function defaultNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function defaultSchedule(callback: () => void): number {
  if (typeof requestAnimationFrame === 'function') {
    return requestAnimationFrame(callback);
  }
  return setTimeout(callback, 16) as unknown as number;
}

function defaultCancel(handle: number): void {
  if (typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(handle);
    return;
  }
  clearTimeout(handle);
}
