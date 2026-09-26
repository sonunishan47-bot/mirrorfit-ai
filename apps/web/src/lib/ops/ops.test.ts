import { describe, expect, it } from 'vitest';

import { aggregateShopAnalytics } from './analytics-aggregate';
import { classifyDisplayHealth, summarizeKioskFleet } from './kiosk-health';
import { summarizeInventoryDistribution } from './inventory-summary';

const SHOP = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

describe('aggregateShopAnalytics', () => {
  it('aggregates shop-scoped sessions and garment selections only', () => {
    const summary = aggregateShopAnalytics(
      [
        {
          id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          shop_id: SHOP,
          status: 'ENDED',
          created_at: '2026-01-01T10:00:00.000Z',
          started_at: '2026-01-01T10:01:00.000Z',
          ended_at: '2026-01-01T10:06:00.000Z',
          pairing_claimed_at: '2026-01-01T10:00:30.000Z',
        },
        {
          id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          shop_id: OTHER,
          status: 'ACTIVE',
          created_at: '2026-01-01T11:00:00.000Z',
          started_at: '2026-01-01T11:01:00.000Z',
          ended_at: null,
          pairing_claimed_at: '2026-01-01T11:00:30.000Z',
        },
      ],
      [
        {
          session_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          shop_id: SHOP,
          type: 'GARMENT_SELECTED',
          occurred_at: '2026-01-01T10:02:00.000Z',
          payload: { category: 'Tops' },
        },
        {
          session_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          shop_id: SHOP,
          type: 'GARMENT_SELECTED',
          occurred_at: '2026-01-01T10:03:00.000Z',
          payload: { category: 'Jeans' },
        },
        {
          session_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          shop_id: OTHER,
          type: 'GARMENT_SELECTED',
          occurred_at: '2026-01-01T11:02:00.000Z',
          payload: { category: 'Tops' },
        },
      ],
      SHOP,
    );

    expect(summary.session_count).toBe(1);
    expect(summary.claimed_sessions).toBe(1);
    expect(summary.ended_sessions).toBe(1);
    expect(summary.garment_selections).toBe(2);
    expect(summary.average_session_duration_ms).toBe(5 * 60_000);
    expect(summary.category_engagement).toEqual([
      { category: 'Jeans', selections: 1 },
      { category: 'Tops', selections: 1 },
    ]);
    expect(JSON.stringify(summary)).not.toMatch(/pairing_token|storage_path|device_secret/);
  });
});

describe('kiosk health', () => {
  it('classifies online, stale, and offline from heartbeat age', () => {
    const now = Date.parse('2026-01-01T12:00:00.000Z');
    expect(
      classifyDisplayHealth(
        {
          id: 'd1',
          name: 'Mirror A',
          shop_id: SHOP,
          status: 'ONLINE',
          last_heartbeat_at: '2026-01-01T11:59:30.000Z',
          camera_ok: true,
          app_version: '1.0.0',
        },
        now,
      ).health,
    ).toBe('online');
    expect(
      classifyDisplayHealth(
        {
          id: 'd2',
          name: 'Mirror B',
          shop_id: SHOP,
          status: 'ONLINE',
          last_heartbeat_at: '2026-01-01T11:57:00.000Z',
          camera_ok: true,
          app_version: '1.0.0',
        },
        now,
      ).health,
    ).toBe('stale');
    expect(
      classifyDisplayHealth(
        {
          id: 'd3',
          name: 'Mirror C',
          shop_id: SHOP,
          status: 'ONLINE',
          last_heartbeat_at: null,
          camera_ok: null,
          app_version: null,
        },
        now,
      ).health,
    ).toBe('offline');
  });

  it('summarizes fleet counts', () => {
    const fleet = summarizeKioskFleet([
      {
        display_id: '1',
        name: 'A',
        shop_id: SHOP,
        health: 'online',
        camera_ok: true,
        app_version: '1',
        last_heartbeat_at: null,
        minutes_since_heartbeat: 0,
      },
      {
        display_id: '2',
        name: 'B',
        shop_id: SHOP,
        health: 'offline',
        camera_ok: null,
        app_version: null,
        last_heartbeat_at: null,
        minutes_since_heartbeat: null,
      },
    ]);
    expect(fleet.online).toBe(1);
    expect(fleet.offline).toBe(1);
  });
});

describe('inventory distribution', () => {
  it('counts overlays by presence only', () => {
    const summary = summarizeInventoryDistribution(
      [
        { id: 'g1', shop_id: SHOP, category: 'Tops', is_active: true },
        { id: 'g2', shop_id: SHOP, category: 'Jeans', is_active: true },
        { id: 'g3', shop_id: OTHER, category: 'Tops', is_active: true },
      ],
      [
        { id: 'v1', garment_id: 'g1', shop_id: SHOP, is_active: true },
        { id: 'v2', garment_id: 'g1', shop_id: SHOP, is_active: true },
        { id: 'v3', garment_id: 'g2', shop_id: SHOP, is_active: true },
      ],
      [{ garment_id: 'g1' }, { garment_id: 'g3' }],
      SHOP,
    );
    expect(summary.active_garments).toBe(2);
    expect(summary.active_variants).toBe(3);
    expect(summary.garments_with_overlay).toBe(1);
    expect(summary.by_category.map((row) => row.category)).toEqual(['Jeans', 'Tops']);
    expect(summary.by_category.find((row) => row.category === 'Tops')?.with_overlay).toBe(1);
    expect(JSON.stringify(summary)).not.toMatch(/storage_path|overlay_url/);
  });
});
