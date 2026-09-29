import { describe, expect, it } from 'vitest';

import { jpegDimensions } from '@mirrorfit/tryon-core';

import {
  VTON_NOT_CONNECTED,
  buildStillInferenceBody,
  generateStill,
  modelInfo,
  preflightStill,
  readVtonProviderConfig,
  safeTryOnLog,
  vtonCapabilities,
} from './vton-provider';

const secret = '0123456789abcdef';

function jpeg(width: number, height: number): Uint8Array {
  const sof = new Uint8Array([
    0xff,
    0xc0,
    0x00,
    0x0b,
    0x08,
    height >> 8,
    height & 0xff,
    width >> 8,
    width & 0xff,
    0x01,
    0x01,
    0x11,
    0x00,
  ]);
  const bytes = new Uint8Array(1200);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes[2] = 0xff;
  bytes.set(sof, 3);
  bytes[bytes.length - 2] = 0xff;
  bytes[bytes.length - 1] = 0xd9;
  return bytes;
}

function jpegBody(bytes: Uint8Array): Blob {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return new Blob([copy], { type: 'image/jpeg' });
}

const job = {
  jobId: 'job-1',
  personUrl: 'https://example.test/person',
  garmentUrl: 'https://example.test/garment',
  garmentCategory: 'Shirt',
  fitCategory: 'TOP' as const,
};

describe('VTON provider boundary', () => {
  it('stays NOT CONNECTED when no worker endpoint is configured', () => {
    const config = readVtonProviderConfig({});
    expect(config.status).toBe('not_connected');
    expect(config.endpointUrl).toBeNull();
    expect(VTON_NOT_CONNECTED).toBe('VTON_NOT_CONNECTED');
    expect(vtonCapabilities({}).activeMode).toBe('still');
    expect(vtonCapabilities({}).videoCapable).toBe(false);
  });

  it('prefers WORKER_ENDPOINT_URL and still accepts the legacy alias', () => {
    const modern = readVtonProviderConfig({
      WORKER_ENDPOINT_URL: 'http://127.0.0.1:8000/infer',
      RUNPOD_ENDPOINT_URL: 'https://ignored.example/infer',
      WORKER_SECRET: secret,
      MODEL_PROVIDER: 'private',
      MODEL_NAME: 'shop-vton',
      MODEL_VERSION: '1',
    });
    expect(modern.status).toBe('configured');
    expect(modern.endpointUrl).toBe('http://127.0.0.1:8000/infer');
    expect(modern.model).toEqual({
      provider: 'private',
      name: 'shop-vton',
      version: '1',
      commercialUse: null,
      videoCapable: false,
    });
    expect(
      readVtonProviderConfig({
        RUNPOD_ENDPOINT_URL: 'https://pod.example/infer',
        WORKER_SECRET: secret,
      }).endpointUrl,
    ).toBe('https://pod.example/infer');
    expect(readVtonProviderConfig({ RUNPOD_ENDPOINT_URL: 'not a url' }).status).toBe(
      'not_connected',
    );
  });

  it('does not call the GPU or invent bytes when the endpoint is missing', async () => {
    let called = false;
    const fetchFn: typeof fetch = () => {
      called = true;
      return Promise.resolve(new Response(null, { status: 500 }));
    };
    const result = await generateStill(job, {}, fetchFn);
    expect(result).toEqual({ ok: false, error: 'VTON_NOT_CONNECTED' });
    expect(called).toBe(false);
  });

  it('blocks known non-commercial checkpoints unless a trial flag is set', () => {
    const env = {
      WORKER_ENDPOINT_URL: 'http://127.0.0.1:8000/infer',
      MODEL_NAME: 'catvton',
    };
    expect(modelInfo(env).commercialUse).toBe(false);
    expect(preflightStill(job, env)).toEqual({ ok: false, error: 'MODEL_LICENSE_BLOCKED' });
    expect(
      preflightStill(
        { ...job, fitCategory: 'FULL_BODY' },
        { ...env, MODEL_NAME: 'idm-vton', MODEL_ALLOW_NONCOMMERCIAL: '1' },
      ),
    ).toEqual({
      ok: false,
      error: 'CATEGORY_UNSUPPORTED',
    });
  });

  it('returns upstream jpeg only and never a stand-in', async () => {
    const picture = jpeg(320, 480);
    expect(jpegDimensions(picture)).toEqual({ width: 320, height: 480 });
    const env = { WORKER_ENDPOINT_URL: 'http://127.0.0.1:8000/infer', MODEL_NAME: 'shop-vton' };
    const fetchFn: typeof fetch = (_url, init) => {
      const raw = init?.body;
      const body = JSON.parse(typeof raw === 'string' ? raw : '{}') as {
        mode: string;
        model: { name: string };
      };
      expect(body.mode).toBe('still');
      expect(body.model.name).toBe('shop-vton');
      return Promise.resolve(
        new Response(jpegBody(picture), {
          status: 200,
          headers: { 'content-type': 'image/jpeg' },
        }),
      );
    };
    const result = await generateStill(job, env, fetchFn);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.jpeg).toEqual(picture);
    const refused = await generateStill(job, env, () =>
      Promise.resolve(
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: { 'content-type': 'image/png' },
        }),
      ),
    );
    expect(refused).toEqual({ ok: false, error: 'VTON_UPSTREAM' });
  });

  it('does not put secrets or signed urls into logs or the model block', () => {
    expect(safeTryOnLog('bearer abcdefghijklmnop https://signed.example/a?token=1')).toBe(
      'bearer [redacted] [url]',
    );
    const body = buildStillInferenceBody(job, modelInfo({}));
    expect(JSON.stringify(body)).not.toMatch(/WORKER_SECRET|sb_secret/);
    expect(body.mode).toBe('still');
  });
});
