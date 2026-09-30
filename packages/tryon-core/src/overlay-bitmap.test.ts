import { describe, expect, it, vi } from 'vitest';

import { loadOverlayBitmap } from './overlay-bitmap';

describe('loadOverlayBitmap', () => {
  it('decodes a PNG blob through createImageBitmap', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    const fetchFn = vi.fn(() => {
      return Promise.resolve(
        new Response(blob, {
          status: 200,
          headers: { 'content-type': 'image/png' },
        }),
      );
    });
    const createImageBitmapFn = vi.fn(() => {
      return Promise.resolve({
        width: 400,
        height: 600,
        close: vi.fn(),
      });
    });

    const loaded = await loadOverlayBitmap('https://cdn.example/overlay.png', {
      fetchFn: fetchFn as unknown as typeof fetch,
      createImageBitmapFn: createImageBitmapFn as unknown as typeof createImageBitmap,
    });

    expect(fetchFn).toHaveBeenCalledOnce();
    expect(loaded?.width).toBe(400);
    expect(loaded?.height).toBe(600);
  });

  it('rejects non-overlay mime types instead of inventing a bitmap', async () => {
    const fetchFn = vi.fn(() => {
      return Promise.resolve(
        new Response(new Blob(['x'], { type: 'image/jpeg' }), {
          status: 200,
          headers: { 'content-type': 'image/jpeg' },
        }),
      );
    });
    const loaded = await loadOverlayBitmap('https://cdn.example/photo.jpg', {
      fetchFn: fetchFn as unknown as typeof fetch,
      createImageBitmapFn: vi.fn() as unknown as typeof createImageBitmap,
    });
    expect(loaded).toBeNull();
  });

  it('returns null when the fetch fails', async () => {
    const loaded = await loadOverlayBitmap('https://cdn.example/missing.png', {
      fetchFn: (() =>
        Promise.resolve(new Response(null, { status: 404 }))) as unknown as typeof fetch,
    });
    expect(loaded).toBeNull();
  });

  it('returns null for empty urls without throwing', async () => {
    await expect(loadOverlayBitmap('')).resolves.toBeNull();
  });

  it('returns null when createImageBitmap throws', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    const loaded = await loadOverlayBitmap('https://cdn.example/overlay.png', {
      fetchFn: (() =>
        Promise.resolve(
          new Response(blob, {
            status: 200,
            headers: { 'content-type': 'image/png' },
          }),
        )) as unknown as typeof fetch,
      createImageBitmapFn: (() =>
        Promise.reject(new Error('decode failed'))) as unknown as typeof createImageBitmap,
    });
    expect(loaded).toBeNull();
  });

  it('returns null for zero-dimension bitmaps', async () => {
    const blob = new Blob([new Uint8Array([1])], { type: 'image/png' });
    const close = vi.fn();
    const loaded = await loadOverlayBitmap('https://cdn.example/empty.png', {
      fetchFn: (() =>
        Promise.resolve(
          new Response(blob, {
            status: 200,
            headers: { 'content-type': 'image/png' },
          }),
        )) as unknown as typeof fetch,
      createImageBitmapFn: (() =>
        Promise.resolve({
          width: 0,
          height: 0,
          close,
        })) as unknown as typeof createImageBitmap,
    });
    expect(loaded).toBeNull();
    expect(close).toHaveBeenCalledOnce();
  });
});
