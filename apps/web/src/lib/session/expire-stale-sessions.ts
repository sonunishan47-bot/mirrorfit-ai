/**
 * Pure model of `public.expire_stale_sessions` predicates.
 *
 * Production enforcement lives in Postgres + pg_cron. This module exists so
 * Vitest can regress thresholds and idempotency without a live database.
 *
 * Thresholds match the SQL (do not invent new values here):
 * - WAITING / PAIRED → expire when pairing_expires_at <= now
 * - ACTIVE → expire when last_activity_at <= now - idleSeconds (default 900)
 */

export const ACTIVE_SESSION_IDLE_SECONDS = 900;

export type ExpirableSessionStatus = 'WAITING' | 'PAIRED' | 'ACTIVE' | 'ENDED' | 'EXPIRED';

export interface ExpirableSessionRow {
  readonly id: string;
  readonly displayId: string;
  readonly organizationId: string;
  status: ExpirableSessionStatus;
  readonly pairingExpiresAt: string | null;
  readonly lastActivityAt: string;
  endReason: 'TIMEOUT' | 'CUSTOMER_ENDED' | 'DISCONNECTED' | 'ERROR' | null;
}

export function sessionIsStaleForExpiry(
  row: ExpirableSessionRow,
  nowMs: number,
  idleSeconds: number = ACTIVE_SESSION_IDLE_SECONDS,
): boolean {
  if (row.status === 'WAITING' || row.status === 'PAIRED') {
    if (!row.pairingExpiresAt) return false;
    const expires = Date.parse(row.pairingExpiresAt);
    return !Number.isNaN(expires) && expires <= nowMs;
  }
  if (row.status === 'ACTIVE') {
    const last = Date.parse(row.lastActivityAt);
    if (Number.isNaN(last)) return false;
    return last <= nowMs - idleSeconds * 1000;
  }
  return false;
}

/**
 * Applies the same filter+update shape as the SQL CTE. Returns how many rows
 * flipped to EXPIRED. Safe to run twice (idempotent).
 */
export function expireStaleSessionsInMemory(
  rows: ExpirableSessionRow[],
  nowMs: number,
  idleSeconds: number = ACTIVE_SESSION_IDLE_SECONDS,
): number {
  let count = 0;
  for (const row of rows) {
    if (!sessionIsStaleForExpiry(row, nowMs, idleSeconds)) continue;
    row.status = 'EXPIRED';
    row.endReason = 'TIMEOUT';
    count += 1;
  }
  return count;
}

/** Claim gate: only WAITING + unexpired pairing window (mirrors SQL). */
export function canClaimPairingSession(
  row: ExpirableSessionRow,
  nowMs: number,
): boolean {
  if (row.status !== 'WAITING') return false;
  if (!row.pairingExpiresAt) return false;
  const expires = Date.parse(row.pairingExpiresAt);
  return !Number.isNaN(expires) && expires > nowMs;
}

/** Activate gate: only PAIRED (mirrors SQL). */
export function canActivatePairedSession(row: ExpirableSessionRow): boolean {
  return row.status === 'PAIRED';
}
