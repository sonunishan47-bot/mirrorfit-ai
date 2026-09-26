import { describe, expect, it } from 'vitest';

import { OverlayLoadGuard, isOverlayLoadCurrent } from './overlay-load-guard';

describe('OverlayLoadGuard', () => {
  it('marks only the latest begin() token as current', () => {
    const guard = new OverlayLoadGuard();
    const first = guard.begin();
    expect(guard.isCurrent(first)).toBe(true);

    const second = guard.begin();
    expect(guard.isCurrent(first)).toBe(false);
    expect(guard.isCurrent(second)).toBe(true);
  });

  it('invalidates in-flight loads on dispose-style invalidate', () => {
    const guard = new OverlayLoadGuard();
    const token = guard.begin();
    guard.invalidate();
    expect(guard.isCurrent(token)).toBe(false);
  });

  it('rejects zero or mismatched tokens', () => {
    expect(isOverlayLoadCurrent(0, 0)).toBe(false);
    expect(isOverlayLoadCurrent(2, 1)).toBe(false);
    expect(isOverlayLoadCurrent(3, 3)).toBe(true);
  });
});
