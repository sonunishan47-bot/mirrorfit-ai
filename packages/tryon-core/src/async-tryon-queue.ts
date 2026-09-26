/**
 * Latest-only async work queue for optional photorealistic generate calls.
 *
 * Drops superseded requests so a slow AI callback cannot overwrite a newer
 * garment selection. Timeouts resolve to null so the kiosk keeps the geometric
 * overlay without freezing.
 */

export type AsyncTryOnTask<T> = (signal: { readonly cancelled: boolean }) => Promise<T | null>;

type PendingSlot = {
  readonly generation: number;
  readonly run: AsyncTryOnTask<unknown>;
  readonly resolve: (value: unknown) => void;
};

export class AsyncTryOnQueue {
  #generation = 0;
  #busy = false;
  #pending: PendingSlot | null = null;
  readonly #timeoutMs: number;

  constructor(timeoutMs = 2_500) {
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
    if (this.#pending) {
      this.#pending.resolve(null);
      this.#pending = null;
    }
    return new Promise<T | null>((resolve) => {
      this.#pending = {
        generation,
        run: task as AsyncTryOnTask<unknown>,
        resolve: (value) => resolve(value as T | null),
      };
      void this.#pump();
    });
  }

  /** Invalidate all in-flight and pending work (dispose / garment clear). */
  cancel(): void {
    this.#generation += 1;
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
    const token = { cancelled: false };
    const watch = next.generation;
    try {
      const result = await Promise.race([
        next.run(token),
        sleep(this.#timeoutMs).then(() => null),
      ]);
      if (watch !== this.#generation) {
        token.cancelled = true;
        next.resolve(null);
      } else {
        next.resolve(result);
      }
    } catch {
      next.resolve(null);
    } finally {
      this.#busy = false;
      if (this.#pending) {
        void this.#pump();
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
