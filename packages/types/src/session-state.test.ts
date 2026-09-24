import { describe, expect, it } from 'vitest';
import { SESSION_STATUSES } from './enums';
import { canTransitionSession, isTerminalSessionStatus } from './session-state';

describe('session state machine', () => {
  it('follows the happy path from WAITING to ENDED', () => {
    expect(canTransitionSession('WAITING', 'PAIRED')).toBe(true);
    expect(canTransitionSession('PAIRED', 'ACTIVE')).toBe(true);
    expect(canTransitionSession('ACTIVE', 'ENDED')).toBe(true);
  });

  it('never allows a terminal session to be revived', () => {
    for (const target of SESSION_STATUSES) {
      expect(canTransitionSession('ENDED', target)).toBe(false);
      expect(canTransitionSession('EXPIRED', target)).toBe(false);
    }
  });

  it('rejects skipping the pairing step', () => {
    expect(canTransitionSession('WAITING', 'ACTIVE')).toBe(false);
  });

  it('rejects moving backwards', () => {
    expect(canTransitionSession('ACTIVE', 'PAIRED')).toBe(false);
    expect(canTransitionSession('PAIRED', 'WAITING')).toBe(false);
  });

  it('allows every non-terminal status to expire', () => {
    for (const status of SESSION_STATUSES) {
      if (isTerminalSessionStatus(status)) continue;
      expect(canTransitionSession(status, 'EXPIRED')).toBe(true);
    }
  });
});
