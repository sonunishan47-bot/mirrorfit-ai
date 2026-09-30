import { describe, expect, it, vi } from 'vitest';

import { OverlayBitmapCache } from './overlay-cache';

function fakeBitmap(id: string): { bitmap: ImageBitmap; close: ReturnType<typeof vi.fn> } {
  const close = vi.fn();
  const bitmap = {
    width: 10,
    height: 20,
    close,
    id,
  } as unknown as ImageBitmap;
  return { bitmap, close };
}

describe('OverlayBitmapCache', () => {
  it('caches by content_hash and returns the same entry', () => {
    const cache = new OverlayBitmapCache(4);
    const made = fakeBitmap('a');
    cache.set('a'.repeat(64), { bitmap: made.bitmap, width: 10, height: 20 });
    expect(cache.get('a'.repeat(64))?.bitmap).toBe(made.bitmap);
    expect(cache.size).toBe(1);
  });

  it('evicts LRU entries and closes ImageBitmaps', () => {
    const cache = new OverlayBitmapCache(2);
    const first = fakeBitmap('1');
    const second = fakeBitmap('2');
    const third = fakeBitmap('3');
    cache.set('1'.repeat(64), { bitmap: first.bitmap, width: 1, height: 1 });
    cache.set('2'.repeat(64), { bitmap: second.bitmap, width: 1, height: 1 });
    // Touch first so second becomes LRU.
    expect(cache.get('1'.repeat(64))).not.toBeNull();
    cache.set('3'.repeat(64), { bitmap: third.bitmap, width: 1, height: 1 });
    expect(cache.has('2'.repeat(64))).toBe(false);
    expect(second.close).toHaveBeenCalledOnce();
    expect(cache.has('1'.repeat(64))).toBe(true);
    expect(cache.has('3'.repeat(64))).toBe(true);
  });

  it('clear closes all bitmaps', () => {
    const cache = new OverlayBitmapCache(4);
    const a = fakeBitmap('a');
    const b = fakeBitmap('b');
    cache.set('a'.repeat(64), { bitmap: a.bitmap, width: 1, height: 1 });
    cache.set('b'.repeat(64), { bitmap: b.bitmap, width: 1, height: 1 });
    cache.clear();
    expect(cache.size).toBe(0);
    expect(a.close).toHaveBeenCalledOnce();
    expect(b.close).toHaveBeenCalledOnce();
  });

  it('ignores empty hashes and does not invent entries', () => {
    const cache = new OverlayBitmapCache();
    cache.set('', { bitmap: fakeBitmap('x').bitmap, width: 1, height: 1 });
    expect(cache.get('')).toBeNull();
    expect(cache.size).toBe(0);
  });
});
