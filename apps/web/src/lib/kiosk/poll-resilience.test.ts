import { describe, expect, it } from 'vitest';

import {
  createPollResilienceState,
  notePollFailure,
  notePollSuccess,
  shouldForcePollOnReconnect,
} from './poll-resilience';

describe('poll resilience', () => {
  it('stays ok until the degraded threshold', () => {
    let state = createPollResilienceState();
    state = notePollFailure(state, 1, 3);
    state = notePollFailure(state, 2, 3);
    expect(state.health).toBe('ok');
    expect(state.consecutiveFailures).toBe(2);
    state = notePollFailure(state, 3, 3);
    expect(state.health).toBe('degraded');
  });

  it('clears degradation on the next success without ending a session', () => {
    let state = createPollResilienceState();
    state = notePollFailure(state, 1, 1);
    expect(state.health).toBe('degraded');
    state = notePollSuccess(state, 10);
    expect(state.health).toBe('ok');
    expect(state.consecutiveFailures).toBe(0);
    expect(state.lastSuccessAtMs).toBe(10);
  });

  it('forces reconnect polls after any failure streak', () => {
    expect(shouldForcePollOnReconnect(createPollResilienceState())).toBe(false);
    expect(shouldForcePollOnReconnect(notePollFailure(createPollResilienceState(), 1, 5))).toBe(
      true,
    );
  });
});
