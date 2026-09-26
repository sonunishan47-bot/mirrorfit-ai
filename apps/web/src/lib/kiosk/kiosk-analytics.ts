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
}

export class KioskAnalyticsBuffer {
  #tryOnSelections = 0;
  #categoryTop = 0;
  #categoryLower = 0;
  #categoryOther = 0;
  #sessionsStarted = 0;
  #sessionsEnded = 0;
  #personSeenTicks = 0;

  noteTryOnSelection(fitFamily: 'TOP' | 'LOWER_BODY' | null): void {
    this.#tryOnSelections += 1;
    if (fitFamily === 'TOP') this.#categoryTop += 1;
    else if (fitFamily === 'LOWER_BODY') this.#categoryLower += 1;
    else this.#categoryOther += 1;
  }

  noteSessionStarted(): void {
    this.#sessionsStarted += 1;
  }

  noteSessionEnded(): void {
    this.#sessionsEnded += 1;
  }

  notePersonSeen(): void {
    this.#personSeenTicks += 1;
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
    };
  }
}
