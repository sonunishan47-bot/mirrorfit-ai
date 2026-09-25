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
  it('says the attract screen is a camera shell, not a try-on', () => {
    const view = presentKiosk('IDLE');
    expect(view.title).toBe('MIRRORFIT AI');
    expect(view.subtitle).toBe('Scan to Start');
    expect(view.showQrPlaceholder).toBe(true);
    expect(view.honesty.toLowerCase()).toContain('not implemented');
  });

  it('does not describe the live camera as fitting', () => {
    const view = presentKiosk('ACTIVE');
    expect(view.showQrPlaceholder).toBe(false);
    expect(view.honesty.toLowerCase()).toContain('not an ai try-on');
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
