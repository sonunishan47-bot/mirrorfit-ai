import { describe, expect, it } from 'vitest';

import { UnavailablePoseProvider } from '@mirrorfit/tryon-core';

import { createKioskPoseProvider, MediaPipePoseProvider } from './mediapipe-pose-provider';

describe('MediaPipe pose provider in Node', () => {
  it('fails initialize without a browser window and does not invent landmarks', async () => {
    const provider = new MediaPipePoseProvider();
    await provider.initialize();
    expect(provider.availability).toBe('unavailable');
    expect(provider.lastError).toMatch(/browser window|WebAssembly|failed/i);
    expect(
      await provider.processFrame({
        timestampMs: 1,
        width: 1280,
        height: 720,
        source: {} as CanvasImageSource,
      }),
    ).toBeNull();
    await provider.dispose();
  });

  it('falls back to UnavailablePoseProvider after a failed create', async () => {
    const provider = await createKioskPoseProvider();
    expect(provider).toBeInstanceOf(UnavailablePoseProvider);
    expect(provider.availability).toBe('unavailable');
    expect(provider.lastError).toBeTruthy();
    await provider.dispose();
  });

  it('can be initialized again after dispose without leaking a landmarker', async () => {
    const provider = new MediaPipePoseProvider();
    await provider.initialize();
    await provider.dispose();
    await provider.initialize();
    expect(provider.availability).toBe('unavailable');
    await provider.dispose();
  });

  it('survives dispose during initialize without inventing landmarks (ACTIVE cycle)', async () => {
    const provider = new MediaPipePoseProvider();
    const init = provider.initialize();
    await provider.dispose();
    await init;
    expect(provider.availability).toBe('unavailable');
    expect(
      await provider.processFrame({
        timestampMs: 1,
        width: 640,
        height: 480,
        source: {} as CanvasImageSource,
      }),
    ).toBeNull();
    await provider.dispose();
  });
});
