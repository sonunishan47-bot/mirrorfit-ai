import { describe, expect, it } from 'vitest';

import {
  claimRateLimiter,
  clientIpFromRequest,
  createRateLimiter,
  createSessionRateLimiter,
  enrollRateLimiter,
} from './rate-limit';

describe('createRateLimiter', () => {
  it('allows up to limit hits inside the window then rejects', () => {
    let now = 1_000;
    const limiter = createRateLimiter({
      limit: 3,
      windowMs: 1_000,
      now: () => now,
    });

    expect(limiter.check('a').ok).toBe(true);
    expect(limiter.check('a').ok).toBe(true);
    expect(limiter.check('a').ok).toBe(true);
    const blocked = limiter.check('a');
    expect(blocked.ok).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it('slides the window so old hits expire', () => {
    let now = 0;
    const limiter = createRateLimiter({
      limit: 2,
      windowMs: 100,
      now: () => now,
    });
    expect(limiter.check('b').ok).toBe(true);
    expect(limiter.check('b').ok).toBe(true);
    expect(limiter.check('b').ok).toBe(false);
    now = 101;
    expect(limiter.check('b').ok).toBe(true);
  });

  it('isolates keys from each other', () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000 });
    expect(limiter.check('one').ok).toBe(true);
    expect(limiter.check('two').ok).toBe(true);
    expect(limiter.check('one').ok).toBe(false);
  });
});

describe('clientIpFromRequest', () => {
  it('prefers the left-most X-Forwarded-For hop', () => {
    const request = new Request('https://example.test/api', {
      headers: {
        'x-forwarded-for': ' 203.0.113.9, 10.0.0.1 ',
        'x-real-ip': '10.0.0.1',
      },
    });
    expect(clientIpFromRequest(request)).toBe('203.0.113.9');
  });

  it('falls back to X-Real-IP then unknown', () => {
    expect(
      clientIpFromRequest(
        new Request('https://example.test/api', { headers: { 'x-real-ip': '198.51.100.2' } }),
      ),
    ).toBe('198.51.100.2');
    expect(clientIpFromRequest(new Request('https://example.test/api'))).toBe('unknown');
  });
});

describe('shared route limiters', () => {
  it('exports claim / enroll / create limiters with positive remaining after one hit', () => {
    claimRateLimiter.reset('test-ip');
    enrollRateLimiter.reset('test-ip');
    createSessionRateLimiter.reset('display-1');
    expect(claimRateLimiter.check('test-ip').ok).toBe(true);
    expect(enrollRateLimiter.check('test-ip').ok).toBe(true);
    expect(createSessionRateLimiter.check('display-1').ok).toBe(true);
  });
});
