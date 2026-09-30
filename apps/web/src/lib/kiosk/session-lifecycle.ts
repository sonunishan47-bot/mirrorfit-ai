/**
 * Pure session open / poll / end guards for the kiosk shell.
 *
 * React effects clear intervals on teardown but cannot cancel in-flight
 * `readLiveSession` callbacks. Without a generation epoch, a poll that
 * started under session A can finish after END → IDLE → create(B) and
 * apply SESSION_ENDED to B, clearing the new QR and looping create.
 *
 * This module owns that epoch and the opening latch. The shell stays a
 * thin wiring layer over create / poll / end HTTP calls.
 */

import type { KioskStatus } from './machine';
import { eventFromLiveSession, type LiveKioskSession } from './session-client';

export type PollApplyResult =
  | { readonly kind: 'stale' }
  | {
      readonly kind: 'ok';
      readonly event: 'PAIRING_CLAIMED' | 'SESSION_ENDED' | null;
      readonly live: LiveKioskSession | null;
    };

export interface SessionLifecycleSnapshot {
  readonly generation: number;
  readonly opening: boolean;
  readonly sessionId: string | null;
  readonly openSeq: number;
}

export interface SessionLifecycleController {
  snapshot(): SessionLifecycleSnapshot;
  canBeginOpen(status: KioskStatus): boolean;
  /** Returns an open sequence token, or null when create must not start. */
  beginOpen(status: KioskStatus): number | null;
  /** Applies create success only if `openSeq` is still the active attempt. */
  completeOpen(openSeq: number, sessionId: string): number | null;
  /** Releases the open latch only if `openSeq` is still the active attempt. */
  failOpen(openSeq: number): void;
  beginPoll(): { readonly generation: number; readonly sessionId: string | null };
  applyPoll(pollGeneration: number, live: LiveKioskSession | null, nowMs: number): PollApplyResult;
  markSessionEnded(): number;
  getSessionId(): string | null;
  getGeneration(): number;
}

/**
 * Creates a mutable lifecycle controller. One instance per kiosk mount.
 */
export function createSessionLifecycle(): SessionLifecycleController {
  let generation = 0;
  let opening = false;
  let openSeq = 0;
  let sessionId: string | null = null;

  return {
    snapshot(): SessionLifecycleSnapshot {
      return { generation, opening, sessionId, openSeq };
    },

    canBeginOpen(status: KioskStatus): boolean {
      return status === 'IDLE' && !opening;
    },

    beginOpen(status: KioskStatus): number | null {
      if (status !== 'IDLE' || opening) return null;
      opening = true;
      openSeq += 1;
      return openSeq;
    },

    completeOpen(seq: number, nextSessionId: string): number | null {
      if (seq !== openSeq || !opening) return null;
      opening = false;
      sessionId = nextSessionId;
      generation += 1;
      return generation;
    },

    failOpen(seq: number): void {
      if (seq !== openSeq) return;
      opening = false;
    },

    beginPoll() {
      return { generation, sessionId };
    },

    applyPoll(
      pollGeneration: number,
      live: LiveKioskSession | null,
      nowMs: number,
    ): PollApplyResult {
      if (pollGeneration !== generation) return { kind: 'stale' };
      if (opening) return { kind: 'stale' };
      if (!sessionId) return { kind: 'stale' };
      return {
        kind: 'ok',
        event: eventFromLiveSession(live, sessionId, nowMs),
        live,
      };
    },

    markSessionEnded(): number {
      sessionId = null;
      opening = false;
      generation += 1;
      return generation;
    },

    getSessionId(): string | null {
      return sessionId;
    },

    getGeneration(): number {
      return generation;
    },
  };
}
