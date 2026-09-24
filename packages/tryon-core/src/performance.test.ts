import { describe, expect, it } from 'vitest';
import {
  evaluateTargets,
  FrameRateCounter,
  PerformanceRegistry,
  PIPELINE_METRICS,
  RollingWindow,
} from './performance';

describe('RollingWindow', () => {
  it('reports null stats before any sample is recorded', () => {
    const window = new RollingWindow(10);
    expect(window.stats()).toBeNull();
    expect(window.percentile(95)).toBeNull();
    expect(window.last).toBeNull();
  });

  it('computes nearest-rank percentiles', () => {
    const window = new RollingWindow(100);
    for (let value = 1; value <= 100; value += 1) window.push(value);
    expect(window.percentile(50)).toBe(50);
    expect(window.percentile(95)).toBe(95);
    expect(window.percentile(100)).toBe(100);
    expect(window.percentile(0)).toBe(1);
  });

  it('evicts oldest samples once at capacity', () => {
    const window = new RollingWindow(3);
    window.push(1);
    window.push(2);
    window.push(3);
    window.push(4);
    expect(window.count).toBe(3);
    const stats = window.stats();
    expect(stats?.min).toBe(2);
    expect(stats?.max).toBe(4);
  });

  it('tracks the most recent sample across wraparound', () => {
    const window = new RollingWindow(3);
    for (const value of [1, 2, 3, 4, 5]) window.push(value);
    expect(window.last).toBe(5);
  });

  it('rejects non-finite samples rather than poisoning the statistics', () => {
    const window = new RollingWindow(5);
    expect(() => window.push(Number.NaN)).toThrow(RangeError);
    expect(() => window.push(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(window.count).toBe(0);
  });

  it('computes mean over the retained window only', () => {
    const window = new RollingWindow(2);
    window.push(0);
    window.push(10);
    window.push(20);
    expect(window.stats()?.mean).toBe(15);
  });
});

describe('FrameRateCounter', () => {
  it('returns null until two frames have been observed', () => {
    const counter = new FrameRateCounter();
    expect(counter.fps()).toBeNull();
    counter.tick(0);
    expect(counter.fps()).toBeNull();
  });

  it('derives frame rate from observed intervals', () => {
    const counter = new FrameRateCounter();
    for (let i = 0; i <= 30; i += 1) counter.tick(i * (1000 / 30));
    expect(counter.fps()).toBeCloseTo(30, 5);
  });

  it('reflects dropped frames as a lower rate', () => {
    const counter = new FrameRateCounter();
    // 10 frames that should span 300ms at 30 FPS actually span 600ms.
    for (let i = 0; i <= 9; i += 1) counter.tick(i * 66.67);
    const fps = counter.fps();
    expect(fps).not.toBeNull();
    expect(fps ?? 0).toBeLessThan(20);
  });
});

describe('PerformanceRegistry', () => {
  it('reports null for metrics that were never measured', () => {
    const registry = new PerformanceRegistry();
    const snapshot = registry.snapshot();
    for (const metric of PIPELINE_METRICS) {
      expect(snapshot[metric]).toBeNull();
    }
  });

  it('records elapsed time around an async stage', async () => {
    const registry = new PerformanceRegistry();
    let clockValue = 0;
    const clock = () => clockValue;

    await registry.time(
      'pose_inference_ms',
      () => {
        clockValue = 12;
        return Promise.resolve('done');
      },
      clock,
    );

    expect(registry.stats('pose_inference_ms')?.last).toBe(12);
  });

  it('still records a sample when the stage throws', async () => {
    const registry = new PerformanceRegistry();
    let clockValue = 0;
    const clock = () => clockValue;

    await expect(
      registry.time(
        'segmentation_ms',
        () => {
          clockValue = 7;
          return Promise.reject(new Error('model failed'));
        },
        clock,
      ),
    ).rejects.toThrow('model failed');

    expect(registry.stats('segmentation_ms')?.last).toBe(7);
  });
});

describe('evaluateTargets', () => {
  it('reports unmeasured targets as null rather than passing', () => {
    const results = evaluateTargets(new PerformanceRegistry().snapshot());
    for (const result of results) {
      expect(result.meetsTarget).toBeNull();
      expect(result.observed).toBeNull();
    }
  });

  it('fails the frame rate target when median render FPS is below 30', () => {
    const registry = new PerformanceRegistry();
    for (let i = 0; i < 20; i += 1) registry.record('render_fps', 24);
    const [fpsResult] = evaluateTargets(registry.snapshot());
    expect(fpsResult?.meetsTarget).toBe(false);
  });

  it('passes the garment swap target when p95 is within budget', () => {
    const registry = new PerformanceRegistry();
    for (let i = 0; i < 100; i += 1) registry.record('garment_swap_ms', 180);
    const swapResult = evaluateTargets(registry.snapshot()).find(
      (result) => result.metric === 'garment_swap_ms',
    );
    expect(swapResult?.meetsTarget).toBe(true);
  });
});
