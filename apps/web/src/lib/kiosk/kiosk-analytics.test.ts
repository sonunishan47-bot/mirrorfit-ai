import { describe, expect, it } from 'vitest';

import { KioskAnalyticsBuffer } from './kiosk-analytics';

describe('KioskAnalyticsBuffer', () => {
  it('counts try-ons by category family without storing garment ids', () => {
    const buffer = new KioskAnalyticsBuffer();
    buffer.noteTryOnSelection('TOP');
    buffer.noteTryOnSelection('LOWER_BODY');
    buffer.noteTryOnSelection('FULL_BODY');
    buffer.noteTryOnSelection(null);
    const snap = buffer.snapshot();
    expect(snap.try_on_selections).toBe(4);
    expect(snap.category_top).toBe(1);
    expect(snap.category_lower).toBe(1);
    expect(snap.category_other).toBe(2);
    expect(JSON.stringify(snap)).not.toMatch(/storage_path|device_secret|organization_id/);
  });

  it('exports heartbeat-safe numeric metrics', () => {
    const buffer = new KioskAnalyticsBuffer();
    buffer.noteSessionStarted();
    buffer.notePersonSeen();
    buffer.noteSessionEnded();
    buffer.noteRenderError();
    const metrics = buffer.toHeartbeatMetrics();
    expect(metrics['sessions_started']).toBe(1);
    expect(metrics['person_seen_ticks']).toBe(1);
    expect(metrics['sessions_ended']).toBe(1);
    expect(metrics['render_errors']).toBe(1);
    for (const value of Object.values(metrics)) {
      expect(typeof value).toBe('number');
    }
  });

  it('caps counters for long-running sessions', () => {
    const buffer = new KioskAnalyticsBuffer();
    for (let i = 0; i < 5; i += 1) buffer.noteRenderError();
    expect(buffer.snapshot().render_errors).toBe(5);
  });
});
