import { describe, expect, it } from 'vitest';

import { kioskSessionPollMs, POLL_MS_ACTIVE, POLL_MS_WAITING } from './session-poll';

describe('kioskSessionPollMs', () => {
  it('uses a fast interval while ACTIVE so garment selection reaches the glass quickly', () => {
    expect(kioskSessionPollMs('ACTIVE')).toBe(POLL_MS_ACTIVE);
    expect(POLL_MS_ACTIVE).toBe(250);
  });

  it('keeps a 1s interval while WAITING / PAIRED (claim path)', () => {
    expect(kioskSessionPollMs('WAITING')).toBe(POLL_MS_WAITING);
    expect(kioskSessionPollMs('PAIRED')).toBe(POLL_MS_WAITING);
    expect(POLL_MS_WAITING).toBe(1_000);
  });
});
