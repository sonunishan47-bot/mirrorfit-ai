/**
 * Periodic health report from the kiosk to `/api/device/heartbeat`.
 *
 * The loop never sends pixels. It sends `camera_ok` and a frame rate taken
 * from `FrameRateCounter`. Before two real frames exist that counter returns
 * null, and null is what goes on the wire — never a fabricated 0.
 */

export const DEFAULT_HEARTBEAT_INTERVAL_MS = 15_000;

export interface HeartbeatSample {
  readonly camera_ok: boolean;
  readonly render_fps: number | null;
}

export interface HeartbeatLoopOptions {
  readonly getSecret: () => string | null;
  readonly getSample: () => HeartbeatSample;
  readonly fetchFn: typeof fetch;
  readonly intervalMs?: number;
  readonly onUnauthorized?: () => void;
}

export interface HeartbeatLoop {
  readonly stop: () => void;
  readonly tick: () => Promise<void>;
}

export function startHeartbeatLoop(options: HeartbeatLoopOptions): HeartbeatLoop {
  const intervalMs = options.intervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
  let stopped = false;

  const tick = async (): Promise<void> => {
    if (stopped) return;
    const secret = options.getSecret();
    if (!secret) return;

    const sample = options.getSample();
    const renderFps = sample.render_fps;
    // Guard against a caller that "helpfully" substitutes 0 for no samples.
    const fps = renderFps === null || renderFps === undefined ? null : renderFps;

    try {
      const response = await options.fetchFn('/api/device/heartbeat', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${secret}`,
        },
        body: JSON.stringify({
          camera_ok: sample.camera_ok,
          render_fps: fps,
          processing_fps: null,
        }),
      });

      if (response.status === 401) {
        options.onUnauthorized?.();
      }
    } catch {
      // Network failure is not a reason to invent telemetry or to crash the
      // glass. The next interval tries again.
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, intervalMs);

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
    tick,
  };
}
