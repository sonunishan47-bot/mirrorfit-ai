import type { SessionStatus } from './enums';

/**
 * Legal session transitions.
 *
 * WAITING  : mirror created the session, QR is on screen, nobody paired yet
 * PAIRED   : a phone claimed the pairing token but the realtime link is not up
 * ACTIVE   : phone and mirror are exchanging protocol messages
 * ENDED    : terminated deliberately (customer tapped end, or staff reset)
 * EXPIRED  : terminated by timeout, disconnect, or token expiry
 *
 * ENDED and EXPIRED are terminal. A terminal session must never be revived,
 * because reuse is exactly how one customer's state would leak into the next
 * customer's session.
 */
export const SESSION_TRANSITIONS: Readonly<Record<SessionStatus, readonly SessionStatus[]>> = {
  WAITING: ['PAIRED', 'ENDED', 'EXPIRED'],
  PAIRED: ['ACTIVE', 'ENDED', 'EXPIRED'],
  ACTIVE: ['ENDED', 'EXPIRED'],
  ENDED: [],
  EXPIRED: [],
};

export const TERMINAL_SESSION_STATUSES: readonly SessionStatus[] = ['ENDED', 'EXPIRED'];

export function isTerminalSessionStatus(status: SessionStatus): boolean {
  return TERMINAL_SESSION_STATUSES.includes(status);
}

export function canTransitionSession(from: SessionStatus, to: SessionStatus): boolean {
  return SESSION_TRANSITIONS[from].includes(to);
}
