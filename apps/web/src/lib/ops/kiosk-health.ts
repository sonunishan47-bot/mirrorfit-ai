/**
 * Kiosk health classification from display heartbeat fields.
 * No device secrets or storage paths appear in the result.
 */

export type KioskHealthStatus = 'online' | 'stale' | 'offline' | 'maintenance' | 'revoked';

export interface DisplayHealthInput {
  readonly id: string;
  readonly name: string;
  readonly shop_id: string;
  readonly status: string;
  readonly last_heartbeat_at: string | null;
  readonly camera_ok: boolean | null;
  readonly app_version: string | null;
}

export interface DisplayHealthRow {
  readonly display_id: string;
  readonly name: string;
  readonly shop_id: string;
  readonly health: KioskHealthStatus;
  readonly camera_ok: boolean | null;
  readonly app_version: string | null;
  readonly last_heartbeat_at: string | null;
  readonly minutes_since_heartbeat: number | null;
}

export const STALE_HEARTBEAT_MS = 90_000;
export const OFFLINE_HEARTBEAT_MS = 5 * 60_000;

export function classifyDisplayHealth(
  display: DisplayHealthInput,
  nowMs: number,
): DisplayHealthRow {
  if (display.status === 'REVOKED') {
    return row(display, 'revoked', null);
  }
  if (display.status === 'MAINTENANCE') {
    return row(display, 'maintenance', minutesSince(display.last_heartbeat_at, nowMs));
  }
  if (!display.last_heartbeat_at) {
    return row(display, 'offline', null);
  }
  const age = nowMs - Date.parse(display.last_heartbeat_at);
  if (!Number.isFinite(age) || age < 0) {
    return row(display, 'offline', null);
  }
  if (age > OFFLINE_HEARTBEAT_MS) {
    return row(display, 'offline', Math.floor(age / 60_000));
  }
  if (age > STALE_HEARTBEAT_MS) {
    return row(display, 'stale', Math.floor(age / 60_000));
  }
  return row(display, 'online', Math.floor(age / 60_000));
}

export function summarizeKioskFleet(rows: readonly DisplayHealthRow[]): {
  readonly online: number;
  readonly stale: number;
  readonly offline: number;
  readonly maintenance: number;
  readonly revoked: number;
} {
  const summary = { online: 0, stale: 0, offline: 0, maintenance: 0, revoked: 0 };
  for (const row of rows) {
    summary[row.health] += 1;
  }
  return summary;
}

function minutesSince(iso: string | null, nowMs: number): number | null {
  if (!iso) return null;
  const age = nowMs - Date.parse(iso);
  if (!Number.isFinite(age) || age < 0) return null;
  return Math.floor(age / 60_000);
}

function row(
  display: DisplayHealthInput,
  health: KioskHealthStatus,
  minutes_since_heartbeat: number | null,
): DisplayHealthRow {
  return {
    display_id: display.id,
    name: display.name,
    shop_id: display.shop_id,
    health,
    camera_ok: display.camera_ok,
    app_version: display.app_version,
    last_heartbeat_at: display.last_heartbeat_at,
    minutes_since_heartbeat,
  };
}
