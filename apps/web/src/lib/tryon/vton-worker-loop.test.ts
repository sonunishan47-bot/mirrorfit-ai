import { describe, expect, it } from 'vitest';

import { runVtonWorker } from './vton-worker-loop';

function hrefOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function textField(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

function jpeg(): Uint8Array {
  const width = 320;
  const height = 480;
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
  return bytes;
}

function jpegBody(bytes: Uint8Array): Blob {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return new Blob([copy], { type: 'image/jpeg' });
}

describe('vton worker loop', () => {
  it('completes VTON_NOT_CONNECTED without calling a GPU', async () => {
    const calls: string[] = [];
    let errorCode = '';
    const fetchFn: typeof fetch = (url, init) => {
      const href = hrefOf(url);
      calls.push(href);
      if (href.endsWith('/claim')) {
        return Promise.resolve(
          Response.json({
            job: {
              job_id: '11111111-1111-4111-8111-111111111111',
              input_url: 'https://signed.example/person',
              garment_reference_url: 'https://signed.example/garment',
              garment_category: 'Shirt',
              fit_category: 'TOP',
            },
          }),
        );
      }
      if (href.endsWith('/complete')) {
        const form = init?.body;
        if (form instanceof FormData) errorCode = textField(form, 'error_code');
        return Promise.resolve(Response.json({ ok: true }));
      }
      return Promise.reject(new Error('gpu should not be called'));
    };

    await runVtonWorker({
      env: {
        MIRRORFIT_APP_ORIGIN: 'https://app.test',
        WORKER_SECRET: '0123456789abcdef',
      },
      fetchFn,
      sleep: () => Promise.resolve(),
      log: () => undefined,
      maxLoops: 1,
    });

    expect(errorCode).toBe('VTON_NOT_CONNECTED');
    expect(calls.some((href) => href.includes('/health') || href.includes('/infer'))).toBe(false);
  });

  it('posts one still to a private endpoint and completes only with that jpeg', async () => {
    const picture = jpeg();
    let status = '';
    let sawStillMode = false;
    const fetchFn: typeof fetch = (url, init) => {
      const href = hrefOf(url);
      if (href.endsWith('/health')) return Promise.resolve(new Response('ok', { status: 200 }));
      if (href.endsWith('/claim')) {
        return Promise.resolve(
          Response.json({
            job: {
              job_id: '22222222-2222-4222-8222-222222222222',
              input_url: 'https://signed.example/person',
              garment_reference_url: 'https://signed.example/garment',
              garment_category: 'Dress',
              fit_category: 'FULL_BODY',
            },
          }),
        );
      }
      if (href.endsWith('/infer')) {
        const raw = init?.body;
        const body = JSON.parse(typeof raw === 'string' ? raw : '{}') as { mode?: string };
        sawStillMode = body.mode === 'still';
        return Promise.resolve(
          new Response(jpegBody(picture), {
            status: 200,
            headers: { 'content-type': 'image/jpeg' },
          }),
        );
      }
      if (href.endsWith('/complete')) {
        const form = init?.body;
        if (form instanceof FormData) status = textField(form, 'status');
        return Promise.resolve(Response.json({ ok: true }));
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    };

    await runVtonWorker({
      env: {
        MIRRORFIT_APP_ORIGIN: 'https://app.test',
        WORKER_SECRET: '0123456789abcdef',
        WORKER_ENDPOINT_URL: 'http://127.0.0.1:8000/infer',
        MODEL_NAME: 'shop-vton',
        MODEL_PROVIDER: 'private',
      },
      fetchFn,
      sleep: () => Promise.resolve(),
      log: () => undefined,
      maxLoops: 1,
    });

    expect(sawStillMode).toBe(true);
    expect(status).toBe('SUCCEEDED');
  });
});
