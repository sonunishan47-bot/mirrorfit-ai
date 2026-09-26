/**
 * Load-generation guard for async overlay fetches.
 *
 * When the shopper changes garments quickly, an older in-flight fetch must
 * not apply its bitmap after a newer selection has started.
 */

export class OverlayLoadGuard {
  #generation = 0;

  /** Bumps the generation and returns the token for this load attempt. */
  begin(): number {
    this.#generation += 1;
    return this.#generation;
  }

  /** True only while `token` is still the latest begin() call. */
  isCurrent(token: number): boolean {
    return token === this.#generation && token > 0;
  }

  get generation(): number {
    return this.#generation;
  }

  /** Invalidate all in-flight loads (e.g. on dispose). */
  invalidate(): void {
    this.#generation += 1;
  }
}

/**
 * Pure helper: a stale token must not apply after the generation advances.
 */
export function isOverlayLoadCurrent(generation: number, token: number): boolean {
  return token === generation && token > 0;
}
