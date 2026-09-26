import { describe, expect, it } from 'vitest';

import { reduceKiosk } from './machine';
import { createSessionLifecycle } from './session-lifecycle';
import { eventFromLiveSession } from './session-client';

const SESSION_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SESSION_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const FUTURE = '2099-01-01T00:00:00.000Z';
const NOW = Date.parse('2026-01-01T00:00:00.000Z');

describe('session lifecycle: stale poll after create', () => {
  it('ignores a poll that started before END → create of a new WAITING session', () => {
    const life = createSessionLifecycle();
    const openA = life.beginOpen('IDLE');
    expect(openA).not.toBeNull();
    expect(life.completeOpen(openA!, SESSION_A)).not.toBeNull();

    const stale = life.beginPoll();
    expect(stale.sessionId).toBe(SESSION_A);

    life.markSessionEnded();
    const openB = life.beginOpen('IDLE');
    expect(openB).not.toBeNull();
    expect(life.completeOpen(openB!, SESSION_B)).not.toBeNull();
    expect(life.getSessionId()).toBe(SESSION_B);

    // Classic flash-loop input: in-flight poll finishes with null/old live
    // after the new session is already open.
    expect(life.applyPoll(stale.generation, null, NOW)).toEqual({ kind: 'stale' });
    expect(
      life.applyPoll(
        stale.generation,
        { sessionId: SESSION_A, status: 'ENDED', pairingExpiresAt: null },
        NOW,
      ),
    ).toEqual({ kind: 'stale' });

    expect(life.getSessionId()).toBe(SESSION_B);
    const current = life.beginPoll();
    expect(
      life.applyPoll(
        current.generation,
        { sessionId: SESSION_B, status: 'WAITING', pairingExpiresAt: FUTURE },
        NOW,
      ),
    ).toEqual({
      kind: 'ok',
      event: null,
      live: { sessionId: SESSION_B, status: 'WAITING', pairingExpiresAt: FUTURE },
    });
  });

  it('does not treat a mismatched live row as SESSION_ENDED for a fresh WAITING id', () => {
    expect(
      eventFromLiveSession(
        { sessionId: SESSION_A, status: 'ENDED', pairingExpiresAt: null },
        SESSION_B,
        NOW,
      ),
    ).toBeNull();
    expect(
      eventFromLiveSession(
        { sessionId: SESSION_A, status: 'ACTIVE', pairingExpiresAt: null },
        SESSION_B,
        NOW,
      ),
    ).toBeNull();
  });
});

describe('session lifecycle: disconnect / end reopens once', () => {
  it('maps phone disconnect (live null) to SESSION_ENDED and allows exactly one reopen', () => {
    const life = createSessionLifecycle();
    const openA = life.beginOpen('IDLE');
    expect(life.completeOpen(openA!, SESSION_A)).not.toBeNull();

    let status = reduceKiosk('IDLE', 'SESSION_OPENED');
    status = reduceKiosk(status, 'PAIRING_CLAIMED');
    status = reduceKiosk(status, 'SESSION_ACTIVATED');
    expect(status).toBe('ACTIVE');

    const poll = life.beginPoll();
    const result = life.applyPoll(poll.generation, null, NOW);
    expect(result).toEqual({ kind: 'ok', event: 'SESSION_ENDED', live: null });

    life.markSessionEnded();
    status = reduceKiosk(status, 'SESSION_ENDED');
    expect(status).toBe('ENDED');
    status = reduceKiosk(status, 'RESET');
    expect(status).toBe('IDLE');

    let createCount = 0;
    const openB = life.beginOpen(status);
    expect(openB).not.toBeNull();
    createCount += 1;
    // Second create while opening must not start.
    expect(life.beginOpen('IDLE')).toBeNull();
    expect(life.completeOpen(openB!, SESSION_B)).not.toBeNull();
    expect(createCount).toBe(1);
    expect(life.getSessionId()).toBe(SESSION_B);

    status = reduceKiosk(status, 'SESSION_OPENED');
    expect(status).toBe('WAITING');
  });

  it('END SESSION then IDLE create runs once; duplicate open is blocked', () => {
    const life = createSessionLifecycle();
    const openA = life.beginOpen('IDLE');
    life.completeOpen(openA!, SESSION_A);

    let status = reduceKiosk('WAITING', 'SESSION_ENDED');
    life.markSessionEnded();
    status = reduceKiosk(status, 'RESET');
    expect(status).toBe('IDLE');

    let creates = 0;
    const first = life.beginOpen(status);
    expect(first).not.toBeNull();
    creates += 1;
    // While the first create is in flight, a second must not start.
    expect(life.beginOpen('IDLE')).toBeNull();
    life.completeOpen(first!, SESSION_B);
    expect(creates).toBe(1);
    expect(life.getSessionId()).toBe(SESSION_B);
    // Shell only begins open from IDLE; after SESSION_OPENED status is WAITING.
    expect(life.beginOpen('WAITING')).toBeNull();
  });

  it('same-id ENDED live still ends the local session (phone left / expired)', () => {
    const life = createSessionLifecycle();
    const openA = life.beginOpen('IDLE');
    life.completeOpen(openA!, SESSION_A);
    const poll = life.beginPoll();
    expect(
      life.applyPoll(
        poll.generation,
        { sessionId: SESSION_A, status: 'ENDED', pairingExpiresAt: null },
        NOW,
      ),
    ).toEqual({
      kind: 'ok',
      event: 'SESSION_ENDED',
      live: { sessionId: SESSION_A, status: 'ENDED', pairingExpiresAt: null },
    });
  });
});

describe('session lifecycle: open guards', () => {
  it('refuses create outside IDLE and while an open is in flight', () => {
    const life = createSessionLifecycle();
    expect(life.canBeginOpen('WAITING')).toBe(false);
    expect(life.beginOpen('WAITING')).toBeNull();
    const seq = life.beginOpen('IDLE');
    expect(seq).not.toBeNull();
    expect(life.canBeginOpen('IDLE')).toBe(false);
    life.failOpen(seq!);
    expect(life.canBeginOpen('IDLE')).toBe(true);
  });

  it('failOpen / completeOpen ignore superseded open sequences', () => {
    const life = createSessionLifecycle();
    const first = life.beginOpen('IDLE');
    expect(first).toBe(1);
    life.failOpen(first!);
    const second = life.beginOpen('IDLE');
    expect(second).toBe(2);
    // Stale cleanup from the first attempt must not clear the second latch.
    life.failOpen(first!);
    expect(life.canBeginOpen('IDLE')).toBe(false);
    expect(life.completeOpen(first!, SESSION_A)).toBeNull();
    expect(life.completeOpen(second!, SESSION_B)).not.toBeNull();
    expect(life.getSessionId()).toBe(SESSION_B);
  });
});
