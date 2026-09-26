import { describe, expect, it } from 'vitest';

import {
  DEFAULT_POWER_SAVE_IDLE_MS,
  evaluatePowerSave,
  isPowerSaveEligible,
  shouldRunTryOnPipeline,
  shouldShowScreensaver,
} from './power-save';

describe('kiosk power-save', () => {
  it('marks IDLE, WAITING, and ACTIVE as eligible', () => {
    expect(isPowerSaveEligible('IDLE')).toBe(true);
    expect(isPowerSaveEligible('WAITING')).toBe(true);
    expect(isPowerSaveEligible('ACTIVE')).toBe(true);
    expect(isPowerSaveEligible('PAIRED')).toBe(false);
    expect(isPowerSaveEligible('ENDED')).toBe(false);
  });

  it('enters saving after the idle timeout', () => {
    expect(
      evaluatePowerSave({
        phase: 'awake',
        nowMs: DEFAULT_POWER_SAVE_IDLE_MS + 1,
        lastActivityMs: 0,
        kioskStatus: 'WAITING',
      }),
    ).toBe('saving');
  });

  it('stays awake before the idle timeout', () => {
    expect(
      evaluatePowerSave({
        phase: 'awake',
        nowMs: 1_000,
        lastActivityMs: 0,
        idleMs: 90_000,
        kioskStatus: 'ACTIVE',
      }),
    ).toBe('awake');
  });

  it('wakes immediately when wake is requested', () => {
    expect(
      evaluatePowerSave({
        phase: 'saving',
        nowMs: 500_000,
        lastActivityMs: 0,
        kioskStatus: 'WAITING',
        wakeRequested: true,
      }),
    ).toBe('awake');
  });

  it('forces awake during PAIRED and ENDED', () => {
    expect(
      evaluatePowerSave({
        phase: 'saving',
        nowMs: 500_000,
        lastActivityMs: 0,
        kioskStatus: 'PAIRED',
      }),
    ).toBe('awake');
  });

  it('pauses try-on only while ACTIVE and saving', () => {
    expect(shouldRunTryOnPipeline('ACTIVE', 'awake')).toBe(true);
    expect(shouldRunTryOnPipeline('ACTIVE', 'saving')).toBe(false);
    expect(shouldRunTryOnPipeline('WAITING', 'awake')).toBe(false);
  });

  it('shows the screensaver only in eligible saving states', () => {
    expect(shouldShowScreensaver('WAITING', 'saving')).toBe(true);
    expect(shouldShowScreensaver('ACTIVE', 'saving')).toBe(true);
    expect(shouldShowScreensaver('WAITING', 'awake')).toBe(false);
    expect(shouldShowScreensaver('PAIRED', 'saving')).toBe(false);
  });
});
