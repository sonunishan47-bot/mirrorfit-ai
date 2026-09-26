import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ACTIVE_SESSION_IDLE_SECONDS,
  canActivatePairedSession,
  canClaimPairingSession,
  expireStaleSessionsInMemory,
  sessionIsStaleForExpiry,
  type ExpirableSessionRow,
} from './expire-stale-sessions';

/** Mirrors apps/web/src/lib/session/pairing.ts — not imported (server-only). */
const DEFAULT_PAIRING_TTL_SECONDS = 120;

const NOW = Date.parse('2026-09-26T12:00:00.000Z');
const ORG_A = 'org-a';
const ORG_B = 'org-b';
const DISPLAY_A = 'display-a';
const DISPLAY_B = 'display-b';

function row( partial: Partial<ExpirableSessionRow> & Pick<ExpirableSessionRow, 'id' | 'status'>): ExpirableSessionRow {
  return {
    displayId: DISPLAY_A,
    organizationId: ORG_A,
    pairingExpiresAt: '2026-09-26T12:02:00.000Z',
    lastActivityAt: '2026-09-26T11:59:00.000Z',
    endReason: null,
    ...partial,
  };
}

describe('expire_stale_sessions thresholds', () => {
  it('uses the SQL default idle window of 900 seconds', () => {
    expect(ACTIVE_SESSION_IDLE_SECONDS).toBe(900);
  });

  it('documents pairing TTL separately from ACTIVE idle (120 vs 900)', () => {
    expect(DEFAULT_PAIRING_TTL_SECONDS).toBe(120);
    expect(DEFAULT_PAIRING_TTL_SECONDS).toBeLessThan(ACTIVE_SESSION_IDLE_SECONDS);
  });

  it('expires stale WAITING when pairing_expires_at has passed', () => {
    const waiting = row({
      id: 'w1',
      status: 'WAITING',
      pairingExpiresAt: '2026-09-26T11:59:00.000Z',
    });
    expect(sessionIsStaleForExpiry(waiting, NOW)).toBe(true);
    expect(expireStaleSessionsInMemory([waiting], NOW)).toBe(1);
    expect(waiting.status).toBe('EXPIRED');
    expect(waiting.endReason).toBe('TIMEOUT');
  });

  it('expires stale PAIRED the same way as WAITING', () => {
    const paired = row({
      id: 'p1',
      status: 'PAIRED',
      pairingExpiresAt: '2026-09-26T11:50:00.000Z',
    });
    expect(expireStaleSessionsInMemory([paired], NOW)).toBe(1);
    expect(paired.status).toBe('EXPIRED');
  });

  it('expires stale ACTIVE after 900s of silence', () => {
    const active = row({
      id: 'a1',
      status: 'ACTIVE',
      lastActivityAt: '2026-09-26T11:44:59.000Z', // 901s before NOW
    });
    expect(sessionIsStaleForExpiry(active, NOW)).toBe(true);
    expect(expireStaleSessionsInMemory([active], NOW)).toBe(1);
    expect(active.status).toBe('EXPIRED');
  });

  it('keeps non-stale WAITING and ACTIVE sessions', () => {
    const waiting = row({
      id: 'w2',
      status: 'WAITING',
      pairingExpiresAt: '2026-09-26T12:01:00.000Z',
    });
    const active = row({
      id: 'a2',
      status: 'ACTIVE',
      lastActivityAt: '2026-09-26T11:50:00.000Z', // 600s idle
    });
    expect(expireStaleSessionsInMemory([waiting, active], NOW)).toBe(0);
    expect(waiting.status).toBe('WAITING');
    expect(active.status).toBe('ACTIVE');
  });

  it('is idempotent — a second sweep expires zero additional rows', () => {
    const waiting = row({
      id: 'w3',
      status: 'WAITING',
      pairingExpiresAt: '2026-09-26T11:00:00.000Z',
    });
    expect(expireStaleSessionsInMemory([waiting], NOW)).toBe(1);
    expect(expireStaleSessionsInMemory([waiting], NOW)).toBe(0);
    expect(waiting.status).toBe('EXPIRED');
  });

  it('does not touch already ENDED sessions', () => {
    const ended = row({
      id: 'e1',
      status: 'ENDED',
      pairingExpiresAt: '2026-09-26T11:00:00.000Z',
      endReason: 'CUSTOMER_ENDED',
    });
    expect(expireStaleSessionsInMemory([ended], NOW)).toBe(0);
    expect(ended.status).toBe('ENDED');
    expect(ended.endReason).toBe('CUSTOMER_ENDED');
  });

  it('blocks claim and activate after expiry', () => {
    const waiting = row({
      id: 'w4',
      status: 'WAITING',
      pairingExpiresAt: '2026-09-26T11:00:00.000Z',
    });
    expect(canClaimPairingSession(waiting, NOW)).toBe(false);
    expireStaleSessionsInMemory([waiting], NOW);
    expect(canClaimPairingSession(waiting, NOW)).toBe(false);
    expect(canActivatePairedSession(waiting)).toBe(false);

    const paired = row({
      id: 'p2',
      status: 'PAIRED',
      pairingExpiresAt: '2026-09-26T11:00:00.000Z',
    });
    expect(canActivatePairedSession(paired)).toBe(true);
    expireStaleSessionsInMemory([paired], NOW);
    expect(canActivatePairedSession(paired)).toBe(false);
  });

  it('preserves tenant/display isolation while sweeping', () => {
    const rows = [
      row({
        id: 'a-stale',
        status: 'WAITING',
        organizationId: ORG_A,
        displayId: DISPLAY_A,
        pairingExpiresAt: '2026-09-26T11:00:00.000Z',
      }),
      row({
        id: 'b-fresh',
        status: 'WAITING',
        organizationId: ORG_B,
        displayId: DISPLAY_B,
        pairingExpiresAt: '2026-09-26T12:05:00.000Z',
      }),
    ];
    expect(expireStaleSessionsInMemory(rows, NOW)).toBe(1);
    expect(rows[0]?.status).toBe('EXPIRED');
    expect(rows[1]?.status).toBe('WAITING');
    expect(rows[1]?.organizationId).toBe(ORG_B);
  });
});

describe('expire_stale_sessions schedule migration contract', () => {
  const migration = readFileSync(
    resolve(
      import.meta.dirname,
      '../../../../../supabase/migrations/20260926090000_schedule_expire_stale_sessions.sql',
    ),
    'utf8',
  );

  it('enables pg_cron and schedules the existing RPC every minute with idle=900', () => {
    expect(migration).toContain('create extension if not exists pg_cron');
    expect(migration).toContain("'expire-stale-sessions'");
    expect(migration).toContain("'* * * * *'");
    expect(migration).toContain('expire_stale_sessions(900)');
    expect(migration).not.toMatch(/service_role|SUPABASE_SECRET|Bearer|api[_-]?key/i);
  });
});
