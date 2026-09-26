import { describe, expect, it } from 'vitest';

import { KioskAnalyticsBuffer } from './kiosk-analytics';

describe('KioskAnalyticsBuffer', () => {
  it('counts try-ons by category family without storing garment ids', () => {
    const buffer = new KioskAnalyticsBuffer();
    buffer.noteTryOnSelection('TOP');
    buffer.noteTryOnSelection('LOWER_BODY');
    buffer.noteTryOnSelection(null);
    const snap = buffer.snapshot();
    expect(snap.try_on_selections).toBe(3);
    expect(snap.category_top).toBe(1);
    expect(snap.category_lower).toBe(1);
    expect(snap.category_other).toBe(1);
    expect(JSON.stringify(snap)).not.toMatch(/storage_path|device_secret|organization_id/);
  });

  it('exports heartbeat-safe numeric metrics', () => {
    const buffer = new KioskAnalyticsBuffer();
    buffer.noteSessionStarted();
    buffer.notePersonSeen();
    buffer.noteSessionEnded();
    const metrics = buffer.toHeartbeatMetrics();
    expect(metrics['sessions_started']).toBe(1);
    expect(metrics['person_seen_ticks']).toBe(1);
    expect(metrics['sessions_ended']).toBe(1);
    for (const value of Object.values(metrics)) {
      expect(typeof value).toBe('number');
    }
  });
});
