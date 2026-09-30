import type { KioskStatus } from './machine';

/** Default inactivity before the kiosk enters the screensaver / power-save surface. */
export const DEFAULT_POWER_SAVE_IDLE_MS = 90_000;

export type PowerSavePhase = 'awake' | 'saving';

/**
 * Session statuses where prolonged inactivity may enter power-save.
 * PAIRED / ENDED stay awake so connect and end animations are not interrupted.
 */
export function isPowerSaveEligible(status: KioskStatus): boolean {
  return status === 'IDLE' || status === 'WAITING' || status === 'ACTIVE';
}

/**
 * Pure power-save decision. Orthogonal to the session state machine —
 * does not invent session transitions.
 */
export function evaluatePowerSave(input: {
  readonly phase: PowerSavePhase;
  readonly nowMs: number;
  readonly lastActivityMs: number;
  readonly idleMs?: number;
  readonly kioskStatus: KioskStatus;
  /** Immediate wake (claim, pointer, presence, garment change). */
  readonly wakeRequested?: boolean;
}): PowerSavePhase {
  if (input.wakeRequested) return 'awake';
  if (!isPowerSaveEligible(input.kioskStatus)) return 'awake';

  const idleMs =
    typeof input.idleMs === 'number' && Number.isFinite(input.idleMs) && input.idleMs > 0
      ? input.idleMs
      : DEFAULT_POWER_SAVE_IDLE_MS;

  const elapsed = input.nowMs - input.lastActivityMs;
  if (!Number.isFinite(elapsed) || elapsed < 0) return input.phase;
  if (elapsed >= idleMs) return 'saving';
  return 'awake';
}

/**
 * Whether MediaPipe / try-on processing should run.
 * Power-save pauses intensive vision work while the session may still be open.
 */
export function shouldRunTryOnPipeline(kioskStatus: KioskStatus, phase: PowerSavePhase): boolean {
  return kioskStatus === 'ACTIVE' && phase === 'awake';
}

/**
 * Whether the branded screensaver overlay should cover the viewport.
 */
export function shouldShowScreensaver(kioskStatus: KioskStatus, phase: PowerSavePhase): boolean {
  return phase === 'saving' && isPowerSaveEligible(kioskStatus);
}
