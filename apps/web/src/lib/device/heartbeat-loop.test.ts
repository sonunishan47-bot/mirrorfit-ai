import { describe, expect, it } from 'vitest';

import { startHeartbeatLoop } from './heartbeat-loop';

const SECRET = 'b'.repeat(43);

describe('heartbeat loop', () => {
  it('sends null FPS before any camera samples exist', async () => {
    let body: unknown;
    const loop = startHeartbeatLoop({
      getSecret: () => SECRET,
      getSample: () => ({ camera_ok: true, render_fps: null }),
      intervalMs: 60_000,
      fetchFn: async (_url, init) => {
        body = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
      },
    });

    await loop.tick();
    loop.stop();

    expect(body).toEqual({
      camera_ok: true,
      render_fps: null,
      processing_fps: null,
    });
  });

  it('sends a measured FPS after samples exist', async () => {
    let body: { render_fps?: number | null } | undefined;
    const loop = startHeartbeatLoop({
      getSecret: () => SECRET,
      getSample: () => ({ camera_ok: true, render_fps: 59.5 }),
      intervalMs: 60_000,
      fetchFn: async (_url, init) => {
        body = JSON.parse(String(init?.body)) as { render_fps?: number | null };
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
      },
    });

    await loop.tick();
    loop.stop();

    expect(body?.render_fps).toBe(59.5);
  });

  it('does not send after stop', async () => {
    let calls = 0;
    const loop = startHeartbeatLoop({
      getSecret: () => SECRET,
      getSample: () => ({ camera_ok: true, render_fps: null }),
      intervalMs: 60_000,
      fetchFn: async () => {
        calls += 1;
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
      },
    });

    loop.stop();
    await loop.tick();
    expect(calls).toBe(0);
  });

  it('does nothing when no device is enrolled', async () => {
    let calls = 0;
    const loop = startHeartbeatLoop({
      getSecret: () => null,
      getSample: () => ({ camera_ok: false, render_fps: null }),
      intervalMs: 60_000,
      fetchFn: async () => {
        calls += 1;
        return new Response('no', { status: 500 });
      },
    });

    await loop.tick();
    loop.stop();
    expect(calls).toBe(0);
  });

  it('swallows a network failure and stays silent about the secret', async () => {
    const loop = startHeartbeatLoop({
      getSecret: () => SECRET,
      getSample: () => ({ camera_ok: false, render_fps: null }),
      intervalMs: 60_000,
      fetchFn: async () => {
        throw new Error('network down');
      },
    });

    await expect(loop.tick()).resolves.toBeUndefined();
    loop.stop();
  });

  it('does not put frames or pixels on the wire', async () => {
    let body: Record<string, unknown> | undefined;
    const loop = startHeartbeatLoop({
      getSecret: () => SECRET,
      getSample: () => ({ camera_ok: true, render_fps: 30 }),
      intervalMs: 60_000,
      fetchFn: async (_url, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
      },
    });

    await loop.tick();
    loop.stop();

    expect(Object.keys(body ?? {}).sort()).toEqual(['camera_ok', 'processing_fps', 'render_fps']);
    expect(JSON.stringify(body)).not.toMatch(/frame|pixel|image|png|jpeg/i);
  });

  it('includes coarse analytics metrics without frames or secrets', async () => {
    let body: Record<string, unknown> | undefined;
    const loop = startHeartbeatLoop({
      getSecret: () => SECRET,
      getSample: () => ({
        camera_ok: true,
        render_fps: 30,
        metrics: { try_on_selections: 2, category_top: 1 },
      }),
      intervalMs: 60_000,
      fetchFn: async (_url, init) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
      },
    });

    await loop.tick();
    loop.stop();

    expect(body?.['metrics']).toEqual({ try_on_selections: 2, category_top: 1 });
    expect(JSON.stringify(body)).not.toMatch(/frame|pixel|image|device_secret|storage_path/i);
  });

  it('surfaces a revoked credential without throwing', async () => {
    let unauthorized = false;
    const loop = startHeartbeatLoop({
      getSecret: () => SECRET,
      getSample: () => ({ camera_ok: true, render_fps: null }),
      intervalMs: 60_000,
      onUnauthorized: () => {
        unauthorized = true;
      },
      fetchFn: async () => new Response(JSON.stringify({ error: 'UNAUTHORIZED' }), { status: 401 }),
    });

    await loop.tick();
    loop.stop();
    expect(unauthorized).toBe(true);
  });
});
