/**
 * Latest-only async work queue for optional photorealistic generate calls.
 *
 * Drops superseded requests so a slow AI callback cannot overwrite a newer
 * garment selection. Timeouts resolve to null so the kiosk keeps the geometric
 * overlay without freezing. The AbortSignal is aborted on timeout and cancel;
 * callers that upload a still must pass it to fetch.
 */

import { PHOTOREALISTIC_QUEUE_TIMEOUT_MS } from './still-capture';

export type AsyncTryOnSignal = {
  cancelled: boolean;
  readonly signal: AbortSignal;
};

export type AsyncTryOnTask<T> = (signal: AsyncTryOnSignal) => Promise<T | null>;

type PendingSlot = {
  readonly generation: number;
  readonly run: AsyncTryOnTask<unknown>;
  readonly resolve: (value: unknown) => void;
};

export class AsyncTryOnQueue {
  #generation = 0;
  #busy = false;
  #pending: PendingSlot | null = null;
  #timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  #activeAbort: AbortController | null = null;
  readonly #timeoutMs: number;

  constructor(timeoutMs = PHOTOREALISTIC_QUEUE_TIMEOUT_MS) {
    this.#timeoutMs = Math.max(1, timeoutMs);
  }

  get isBusy(): boolean {
    return this.#busy;
  }

  get generation(): number {
    return this.#generation;
  }

  /**
   * Schedules work. Only the latest schedule wins. Returns null on cancel,
   * timeout, supersession, or task failure — never throws to the caller.
   */
  enqueue<T>(task: AsyncTryOnTask<T>): Promise<T | null> {
    const generation = ++this.#generation;
    this.#abortActive();
    if (this.#pending) {
      this.#pending.resolve(null);
      this.#pending = null;
    }
    return new Promise<T | null>((resolve) => {
      this.#pending = {
        generation,
        run: task,
        resolve: (value) => resolve(value as T | null),
      };
      void this.#pump();
    });
  }

  /** Invalidate all in-flight and pending work (dispose / garment clear). */
  cancel(): void {
    this.#generation += 1;
    this.#clearTimeout();
    this.#abortActive();
    if (this.#pending) {
      this.#pending.resolve(null);
      this.#pending = null;
    }
  }

  async #pump(): Promise<void> {
    if (this.#busy) return;
    const next = this.#pending;
    if (!next) return;
    this.#pending = null;
    this.#busy = true;
    const controller = new AbortController();
    this.#activeAbort = controller;
    const token: AsyncTryOnSignal = { cancelled: false, signal: controller.signal };
    const watch = next.generation;
    try {
      const result = await Promise.race([
        next.run(token),
        this.#timeout(this.#timeoutMs).then(() => {
          token.cancelled = true;
          controller.abort();
          return null;
        }),
      ]);
      if (watch !== this.#generation) {
        token.cancelled = true;
        controller.abort();
        next.resolve(null);
      } else {
        next.resolve(result);
      }
    } catch {
      next.resolve(null);
    } finally {
      this.#clearTimeout();
      if (this.#activeAbort === controller) this.#activeAbort = null;
      this.#busy = false;
      if (this.#pending) {
        void this.#pump();
      }
    }
  }

  #abortActive(): void {
    this.#activeAbort?.abort();
    this.#activeAbort = null;
  }

  #timeout(ms: number): Promise<void> {
    this.#clearTimeout();
    return new Promise((resolve) => {
      this.#timeoutHandle = setTimeout(() => {
        this.#timeoutHandle = null;
        resolve();
      }, ms);
    });
  }

  #clearTimeout(): void {
    if (this.#timeoutHandle !== null) {
      clearTimeout(this.#timeoutHandle);
      this.#timeoutHandle = null;
    }
  }
}
