import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { loadOverlayBitmap } from './overlay-bitmap';
import { matchesContentHash, sha256Hex } from './overlay-integrity';

function nodeDigest(data: ArrayBuffer): Promise<ArrayBuffer> {
  const hash = createHash('sha256').update(Buffer.from(data)).digest();
  return Promise.resolve(hash.buffer.slice(hash.byteOffset, hash.byteOffset + hash.byteLength));
}

describe('overlay integrity', () => {
  it('hashes bytes to a 64-char lowercase hex digest', async () => {
    const data = new TextEncoder().encode('mirrorfit-overlay').buffer;
    const hex = await sha256Hex(data, nodeDigest);
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
    expect(await matchesContentHash(data, hex!, nodeDigest)).toBe(true);
  });

  it('rejects a mismatched content hash', async () => {
    const data = new TextEncoder().encode('a').buffer;
    const other = '0'.repeat(64);
    expect(await matchesContentHash(data, other, nodeDigest)).toBe(false);
  });

  it('rejects malformed expected hashes', async () => {
    const data = new TextEncoder().encode('a').buffer;
    expect(await matchesContentHash(data, 'not-a-hash', nodeDigest)).toBe(false);
  });
});

describe('loadOverlayBitmap with content_hash', () => {
  it('accepts bytes that match the expected hash', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const expected = await sha256Hex(bytes.buffer, nodeDigest);
    expect(expected).toBeTruthy();
    const blob = new Blob([bytes], { type: 'image/png' });
    const loaded = await loadOverlayBitmap('https://cdn.example/ok.png', {
      fetchFn: (() =>
        Promise.resolve(
          new Response(blob, {
            status: 200,
            headers: { 'content-type': 'image/png' },
          }),
        )) as unknown as typeof fetch,
      createImageBitmapFn: (() =>
        Promise.resolve({
          width: 10,
          height: 20,
          close: vi.fn(),
        })) as unknown as typeof createImageBitmap,
      expectedContentHash: expected!,
      digestFn: nodeDigest,
    });
    expect(loaded?.width).toBe(10);
  });

  it('returns null when the hash does not match — never draws tampered bytes', async () => {
    const blob = new Blob([new Uint8Array([9, 9, 9])], { type: 'image/png' });
    const createImageBitmapFn = vi.fn(() => {
      return Promise.resolve({ width: 10, height: 10, close: vi.fn() });
    });
    const loaded = await loadOverlayBitmap('https://cdn.example/bad.png', {
      fetchFn: (() =>
        Promise.resolve(
          new Response(blob, {
            status: 200,
            headers: { 'content-type': 'image/png' },
          }),
        )) as unknown as typeof fetch,
      createImageBitmapFn: createImageBitmapFn as unknown as typeof createImageBitmap,
      expectedContentHash: 'a'.repeat(64),
      digestFn: nodeDigest,
    });
    expect(loaded).toBeNull();
    expect(createImageBitmapFn).not.toHaveBeenCalled();
  });
});
