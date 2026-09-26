/**
 * Coarse kiosk analytics buffer.
 *
 * Counts only — no faces, frames, storage paths, secrets, or phone tokens.
 * Snapshots ride along device heartbeats in the existing `metrics` map.
 */

export interface KioskAnalyticsSnapshot {
  readonly try_on_selections: number;
  readonly category_top: number;
  readonly category_lower: number;
  readonly category_other: number;
  readonly sessions_started: number;
  readonly sessions_ended: number;
  readonly person_seen_ticks: number;
  readonly render_errors: number;
}

export class KioskAnalyticsBuffer {
  #tryOnSelections = 0;
  #categoryTop = 0;
  #categoryLower = 0;
  #categoryOther = 0;
  #sessionsStarted = 0;
  #sessionsEnded = 0;
  #personSeenTicks = 0;
  #renderErrors = 0;

  static readonly MAX_COUNTER = 1_000_000;

  noteTryOnSelection(fitFamily: 'TOP' | 'LOWER_BODY' | null): void {
    this.#tryOnSelections = bump(this.#tryOnSelections);
    if (fitFamily === 'TOP') this.#categoryTop = bump(this.#categoryTop);
    else if (fitFamily === 'LOWER_BODY') this.#categoryLower = bump(this.#categoryLower);
    else this.#categoryOther = bump(this.#categoryOther);
  }

  noteSessionStarted(): void {
    this.#sessionsStarted = bump(this.#sessionsStarted);
  }

  noteSessionEnded(): void {
    this.#sessionsEnded = bump(this.#sessionsEnded);
  }

  notePersonSeen(): void {
    this.#personSeenTicks = bump(this.#personSeenTicks);
  }

  noteRenderError(): void {
    this.#renderErrors = bump(this.#renderErrors);
  }

  snapshot(): KioskAnalyticsSnapshot {
    return {
      try_on_selections: this.#tryOnSelections,
      category_top: this.#categoryTop,
      category_lower: this.#categoryLower,
      category_other: this.#categoryOther,
      sessions_started: this.#sessionsStarted,
      sessions_ended: this.#sessionsEnded,
      person_seen_ticks: this.#personSeenTicks,
      render_errors: this.#renderErrors,
    };
  }

  /** Heartbeat-safe metrics map (numbers only). */
  toHeartbeatMetrics(): Record<string, number> {
    const snap = this.snapshot();
    return {
      try_on_selections: snap.try_on_selections,
      category_top: snap.category_top,
      category_lower: snap.category_lower,
      category_other: snap.category_other,
      sessions_started: snap.sessions_started,
      sessions_ended: snap.sessions_ended,
      person_seen_ticks: snap.person_seen_ticks,
      render_errors: snap.render_errors,
    };
  }
}

function bump(value: number): number {
  return value >= KioskAnalyticsBuffer.MAX_COUNTER ? value : value + 1;
}
