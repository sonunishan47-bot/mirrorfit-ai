import type { KioskStatus } from './machine';

/** Poll while WAITING / PAIRED — claim detection, not selection latency. */
export const POLL_MS_WAITING = 1_000;

/**
 * Poll while ACTIVE — phone garment selection → glass. Faster than waiting
 * poll without enabling unauthenticated Realtime (Phase 7).
 */
export const POLL_MS_ACTIVE = 250;

/** Keeps ACTIVE selection snappy; claim path stays at 1s. */
export function kioskSessionPollMs(status: KioskStatus): number {
  return status === 'ACTIVE' ? POLL_MS_ACTIVE : POLL_MS_WAITING;
}
