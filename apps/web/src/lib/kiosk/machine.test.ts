import { describe, expect, it } from 'vitest';

import { presentKiosk, reduceKiosk, type KioskEvent, type KioskStatus } from './machine';

function apply(start: KioskStatus, events: readonly KioskEvent[]): KioskStatus {
  return events.reduce((status, event) => reduceKiosk(status, event), start);
}

describe('kiosk state transitions', () => {
  it('opens a session from the attract screen', () => {
    expect(reduceKiosk('IDLE', 'SESSION_OPENED')).toBe('WAITING');
  });

  it('follows the pairing path to an active session', () => {
    expect(apply('IDLE', ['SESSION_OPENED', 'PAIRING_CLAIMED', 'SESSION_ACTIVATED'])).toBe(
      'ACTIVE',
    );
  });

  it('ends an active session and then returns to idle', () => {
    expect(apply('ACTIVE', ['SESSION_ENDED'])).toBe('ENDED');
    expect(apply('ENDED', ['RESET'])).toBe('IDLE');
  });

  it('resets a waiting or paired mirror without requiring an end reason', () => {
    expect(reduceKiosk('WAITING', 'RESET')).toBe('IDLE');
    expect(reduceKiosk('PAIRED', 'RESET')).toBe('IDLE');
    expect(reduceKiosk('ACTIVE', 'RESET')).toBe('IDLE');
  });

  it('ignores events that would resurrect a finished session', () => {
    expect(reduceKiosk('ENDED', 'PAIRING_CLAIMED')).toBe('ENDED');
    expect(reduceKiosk('ENDED', 'SESSION_ACTIVATED')).toBe('ENDED');
    expect(reduceKiosk('IDLE', 'PAIRING_CLAIMED')).toBe('IDLE');
    expect(reduceKiosk('IDLE', 'SESSION_ENDED')).toBe('IDLE');
  });
});

describe('kiosk copy stays honest', () => {
  it('says the attract screen is ready for a live try-on', () => {
    const view = presentKiosk('IDLE');
    expect(view.title).toBe('MIRRORFIT AI');
    expect(view.subtitle).toBe('Scan to Start');
    expect(view.showQrPlaceholder).toBe(true);
    expect(view.honesty.toLowerCase()).toContain('camera ready');
    expect(view.honesty.toLowerCase()).toContain('try-on');
    expect(view.honesty.toLowerCase()).not.toContain('not implemented');
  });

  it('says a paired phone is preparing the live try-on', () => {
    const view = presentKiosk('PAIRED');
    expect(view.showQrPlaceholder).toBe(false);
    expect(view.honesty.toLowerCase()).toContain('phone connected');
    expect(view.honesty.toLowerCase()).toContain('preparing');
    expect(view.honesty.toLowerCase()).not.toContain('not exchanging');
  });

  it('describes active pose overlay fitting without claiming photorealistic AI', () => {
    const view = presentKiosk('ACTIVE');
    expect(view.showQrPlaceholder).toBe(false);
    expect(view.subtitle.toLowerCase()).toContain('live pose');
    expect(view.subtitle.toLowerCase()).not.toContain('preview only');
    expect(view.honesty.toLowerCase()).toContain('pose landmarks');
    expect(view.honesty.toLowerCase()).toContain('overlay');
    expect(view.honesty.toLowerCase()).toContain('not a photorealistic');
  });

  it('covers every status the glass can show', () => {
    for (const status of ['IDLE', 'WAITING', 'PAIRED', 'ACTIVE', 'ENDED'] as const) {
      const view = presentKiosk(status);
      expect(view.status).toBe(status);
      expect(view.title.length).toBeGreaterThan(0);
      expect(view.honesty.length).toBeGreaterThan(0);
    }
  });
});
