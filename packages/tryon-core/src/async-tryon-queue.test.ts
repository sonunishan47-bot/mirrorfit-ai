import { describe, expect, it } from 'vitest';

import { AsyncTryOnQueue } from './async-tryon-queue';
import {
  PHOTOREALISTIC_UNAVAILABLE_REASON,
  UnavailablePhotorealisticTryOnProvider,
} from './unavailable-photorealistic';

describe('UnavailablePhotorealisticTryOnProvider', () => {
  it('never invents a photorealistic result', async () => {
    const provider = new UnavailablePhotorealisticTryOnProvider();
    await provider.initialize();
    expect(provider.availability).toBe('unavailable');
    expect(provider.lastError).toBe(PHOTOREALISTIC_UNAVAILABLE_REASON);
    const result = await provider.generate({
      frame: { timestampMs: 1, width: 1, height: 1, source: {} as CanvasImageSource },
      fit: {
        timestampMs: 1,
        confidence: 1,
        transform: {
          translate: { x: 0.5, y: 0.5 },
          scaleX: 0.2,
          scaleY: 0.3,
          rotation: 0,
        },
      },
      garmentId: 'g1',
      variantId: 'v1',
    });
    expect(result).toBeNull();
    await provider.dispose();
  });
});

describe('AsyncTryOnQueue', () => {
  it('resolves the latest task and drops superseded pending work', async () => {
    const queue = new AsyncTryOnQueue(500);
    let started = 0;
    const first = queue.enqueue(async () => {
      started += 1;
      await new Promise((r) => setTimeout(r, 30));
      return 'a';
    });
    // Allow first to become in-flight before superseding.
    await new Promise((r) => setTimeout(r, 5));
    const second = queue.enqueue(async () => {
      started += 1;
      return 'b';
    });
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toBeNull();
    expect(secondResult).toBe('b');
    expect(started).toBeGreaterThanOrEqual(1);
  });

  it('returns null on timeout without throwing', async () => {
    const queue = new AsyncTryOnQueue(20);
    const result = await queue.enqueue(async () => {
      await new Promise((r) => setTimeout(r, 80));
      return 'late';
    });
    expect(result).toBeNull();
  });

  it('cancel invalidates pending work', async () => {
    const queue = new AsyncTryOnQueue(200);
    const pending = queue.enqueue(async () => {
      await new Promise((r) => setTimeout(r, 50));
      return 'x';
    });
    queue.cancel();
    expect(await pending).toBeNull();
  });

  it('aborts the signal when the timeout fires so an upload can stop', async () => {
    const queue = new AsyncTryOnQueue(25);
    let aborted = false;
    const result = await queue.enqueue(async (token) => {
      token.signal.addEventListener('abort', () => {
        aborted = true;
      });
      await new Promise((r) => setTimeout(r, 80));
      return 'late';
    });
    expect(result).toBeNull();
    expect(aborted).toBe(true);
  });
});
