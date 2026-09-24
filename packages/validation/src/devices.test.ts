import { describe, expect, it } from 'vitest';

import {
  deviceEnrollRequestSchema,
  deviceHeartbeatRequestSchema,
  enrollmentCodeSchema,
} from './devices';

describe('enrollmentCodeSchema', () => {
  it('accepts a canonical code', () => {
    expect(enrollmentCodeSchema.parse('4K7P9WQ2XM3T')).toBe('4K7P9WQ2XM3T');
  });

  it('accepts the grouped form and returns the canonical one', () => {
    // The mirror sends whatever the technician typed. The server hashes the
    // schema's output, so if this did not normalise, a correctly typed code
    // with hyphens would hash to something that matches nothing.
    expect(enrollmentCodeSchema.parse('4K7P-9WQ2-XM3T')).toBe('4K7P9WQ2XM3T');
  });

  it('accepts lower case', () => {
    expect(enrollmentCodeSchema.parse('4k7p9wq2xm3t')).toBe('4K7P9WQ2XM3T');
  });

  it('rejects a code with an excluded character', () => {
    expect(enrollmentCodeSchema.safeParse('UK7P9WQ2XM3T').success).toBe(false);
  });

  it('rejects the wrong length', () => {
    expect(enrollmentCodeSchema.safeParse('ABC').success).toBe(false);
  });
});

describe('deviceEnrollRequestSchema', () => {
  it('accepts a code on its own, since hardware facts are optional', () => {
    const result = deviceEnrollRequestSchema.safeParse({ code: '4K7P-9WQ2-XM3T' });
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
    expect(result.data?.code).toBe('4K7P9WQ2XM3T');
  });

  it('accepts a full report from a mirror', () => {
    const result = deviceEnrollRequestSchema.safeParse({
      code: '4K7P9WQ2XM3T',
      app_version: '1.2.3',
      screen_width: 3840,
      screen_height: 2160,
      hardware_info: { cpu: 'N100', ram_gb: 16, gpu_accelerated: true },
    });
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  });

  it('rejects a non-numeric screen dimension', () => {
    expect(
      deviceEnrollRequestSchema.safeParse({ code: '4K7P9WQ2XM3T', screen_width: 'big' }).success,
    ).toBe(false);
  });

  it('rejects an app version that is not semantic', () => {
    expect(
      deviceEnrollRequestSchema.safeParse({ code: '4K7P9WQ2XM3T', app_version: 'v1' }).success,
    ).toBe(false);
  });
});

describe('deviceHeartbeatRequestSchema', () => {
  it('accepts an empty body from a mirror that measured nothing', () => {
    const result = deviceHeartbeatRequestSchema.safeParse({});
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  });

  it('preserves an explicit null rather than defaulting it to zero', () => {
    // This is the whole reason the metrics are nullish. A mirror that could
    // not measure its frame rate must not be recorded as running at 0 fps.
    const result = deviceHeartbeatRequestSchema.parse({ render_fps: null, camera_ok: null });
    expect(result.render_fps).toBeNull();
    expect(result.camera_ok).toBeNull();
  });

  it('accepts a real sample', () => {
    const result = deviceHeartbeatRequestSchema.safeParse({
      app_version: '1.2.3',
      camera_ok: true,
      render_fps: 59.94,
      processing_fps: 30.1,
      metrics: { dropped_frames: 2 },
    });
    expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  });

  it('rejects a negative frame rate', () => {
    expect(deviceHeartbeatRequestSchema.safeParse({ render_fps: -1 }).success).toBe(false);
  });
});
