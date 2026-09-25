import { describe, expect, it } from 'vitest';

import { CameraFramePipeline } from './frame-pipeline';
import type { CameraFrame } from './providers';

function frame(timestampMs: number): CameraFrame {
  return {
    timestampMs,
    width: 640,
    height: 480,
    source: {} as CanvasImageSource,
  };
}

describe('camera frame pipeline', () => {
  it('starts, processes the latest frame, and stops', async () => {
    const processed: number[] = [];
    let current: CameraFrame | null = frame(1);
    const scheduled: Array<() => void> = [];

    const pipeline = new CameraFramePipeline(
      {
        readFrame: () => current,
        process: (next) => {
          processed.push(next.timestampMs);
          return Promise.resolve();
        },
        now: () => processed.length * 200,
        schedule: (callback) => {
          scheduled.push(callback);
          return scheduled.length;
        },
        cancel: () => undefined,
      },
      10,
    );

    pipeline.start();
    expect(pipeline.isRunning).toBe(true);
    expect(scheduled).toHaveLength(1);
    scheduled[0]?.();
    await Promise.resolve();
    expect(processed).toEqual([1]);

    await pipeline.dispose();
    expect(pipeline.isRunning).toBe(false);
    const afterStop = processed.length;
    current = frame(2);
    scheduled[1]?.();
    await Promise.resolve();
    expect(processed).toHaveLength(afterStop);
  });

  it('does not queue frames while a process call is in flight', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const processed: number[] = [];
    const scheduled: Array<() => void> = [];
    let now = 0;

    const pipeline = new CameraFramePipeline(
      {
        readFrame: () => frame(now),
        process: async (next) => {
          processed.push(next.timestampMs);
          await gate;
        },
        now: () => now,
        schedule: (callback) => {
          scheduled.push(callback);
          return scheduled.length;
        },
        cancel: () => undefined,
      },
      30,
    );

    pipeline.start();
    scheduled[0]?.();
    await Promise.resolve();
    expect(processed).toEqual([0]);
    now = 50;
    scheduled[1]?.();
    await Promise.resolve();
    expect(processed).toEqual([0]);
    expect(pipeline.droppedWhileBusy).toBeGreaterThan(0);
    release();
    await Promise.resolve();
    await pipeline.dispose();
  });

  it('keeps the pipeline running when process rejects a frame', async () => {
    const processed: number[] = [];
    const scheduled: Array<() => void> = [];
    let now = 0;
    let failOnce = true;

    const pipeline = new CameraFramePipeline(
      {
        readFrame: () => frame(now),
        process: (next) => {
          processed.push(next.timestampMs);
          if (failOnce) {
            failOnce = false;
            return Promise.reject(new Error('frame failed'));
          }
          return Promise.resolve();
        },
        now: () => now,
        schedule: (callback) => {
          scheduled.push(callback);
          return scheduled.length;
        },
        cancel: () => undefined,
      },
      30,
    );

    pipeline.start();
    scheduled[0]?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(processed).toEqual([0]);
    now = 50;
    scheduled[1]?.();
    await Promise.resolve();
    await Promise.resolve();
    expect(processed).toEqual([0, 50]);
    await pipeline.dispose();
  });
});
