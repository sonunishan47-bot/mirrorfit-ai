/**
 * Consecutive poll failure tracking for kiosk network resilience.
 *
 * Does not end sessions. A streak of failures marks sync as degraded so the
 * UI can show recovery state; the next successful poll clears it. Epoch
 * ownership stays in session-lifecycle — this module only counts outcomes.
 */

export const DEFAULT_POLL_DEGRADED_AFTER = 3;

export type PollSyncHealth = 'ok' | 'degraded';

export interface PollResilienceState {
  readonly consecutiveFailures: number;
  readonly health: PollSyncHealth;
  readonly lastSuccessAtMs: number | null;
  readonly lastFailureAtMs: number | null;
}

export function createPollResilienceState(): PollResilienceState {
  return {
    consecutiveFailures: 0,
    health: 'ok',
    lastSuccessAtMs: null,
    lastFailureAtMs: null,
  };
}

export function notePollSuccess(
  state: PollResilienceState,
  nowMs: number,
): PollResilienceState {
  return {
    consecutiveFailures: 0,
    health: 'ok',
    lastSuccessAtMs: nowMs,
    lastFailureAtMs: state.lastFailureAtMs,
  };
}

export function notePollFailure(
  state: PollResilienceState,
  nowMs: number,
  degradedAfter: number = DEFAULT_POLL_DEGRADED_AFTER,
): PollResilienceState {
  const threshold =
    typeof degradedAfter === 'number' && Number.isFinite(degradedAfter) && degradedAfter > 0
      ? Math.floor(degradedAfter)
      : DEFAULT_POLL_DEGRADED_AFTER;
  const consecutiveFailures = state.consecutiveFailures + 1;
  return {
    consecutiveFailures,
    health: consecutiveFailures >= threshold ? 'degraded' : state.health,
    lastSuccessAtMs: state.lastSuccessAtMs,
    lastFailureAtMs: nowMs,
  };
}

/**
 * Whether an immediate poll should run after a browser online/visibility event.
 * Always true when sync is degraded; otherwise optional warm reconnect.
 */
export function shouldForcePollOnReconnect(state: PollResilienceState): boolean {
  return state.health === 'degraded' || state.consecutiveFailures > 0;
}
