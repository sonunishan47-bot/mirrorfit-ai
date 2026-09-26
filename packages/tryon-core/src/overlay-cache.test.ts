import { describe, expect, it, vi } from 'vitest';

import { OverlayBitmapCache } from './overlay-cache';

function fakeBitmap(id: string): ImageBitmap {
  return {
    width: 10,
    height: 20,
    close: vi.fn(),
    id,
  } as unknown as ImageBitmap;
}

describe('OverlayBitmapCache', () => {
  it('caches by content_hash and returns the same entry', () => {
    const cache = new OverlayBitmapCache(4);
    const bitmap = fakeBitmap('a');
    cache.set('a'.repeat(64), { bitmap, width: 10, height: 20 });
    expect(cache.get('a'.repeat(64))?.bitmap).toBe(bitmap);
    expect(cache.size).toBe(1);
  });

  it('evicts LRU entries and closes ImageBitmaps', () => {
    const cache = new OverlayBitmapCache(2);
    const first = fakeBitmap('1');
    const second = fakeBitmap('2');
    const third = fakeBitmap('3');
    cache.set('1'.repeat(64), { bitmap: first, width: 1, height: 1 });
    cache.set('2'.repeat(64), { bitmap: second, width: 1, height: 1 });
    // Touch first so second becomes LRU.
    expect(cache.get('1'.repeat(64))).not.toBeNull();
    cache.set('3'.repeat(64), { bitmap: third, width: 1, height: 1 });
    expect(cache.has('2'.repeat(64))).toBe(false);
    expect((second.close as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce();
    expect(cache.has('1'.repeat(64))).toBe(true);
    expect(cache.has('3'.repeat(64))).toBe(true);
  });

  it('clear closes all bitmaps', () => {
    const cache = new OverlayBitmapCache(4);
    const a = fakeBitmap('a');
    const b = fakeBitmap('b');
    cache.set('a'.repeat(64), { bitmap: a, width: 1, height: 1 });
    cache.set('b'.repeat(64), { bitmap: b, width: 1, height: 1 });
    cache.clear();
    expect(cache.size).toBe(0);
    expect(a.close as ReturnType<typeof vi.fn>).toHaveBeenCalledOnce();
    expect(b.close as ReturnType<typeof vi.fn>).toHaveBeenCalledOnce();
  });

  it('ignores empty hashes and does not invent entries', () => {
    const cache = new OverlayBitmapCache();
    cache.set('', { bitmap: fakeBitmap('x'), width: 1, height: 1 });
    expect(cache.get('')).toBeNull();
    expect(cache.size).toBe(0);
  });
});
