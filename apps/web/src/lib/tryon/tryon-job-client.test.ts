import { describe, expect, it } from 'vitest';

import { fetchCurrentTryOnJob, postDeviceTryOnJob } from './tryon-job-client';

const jpeg = new Uint8Array(2048);
jpeg[0] = 0xff;
jpeg[1] = 0xd8;
jpeg[2] = 0xff;

describe('device try-on client', () => {
  it('posts one JPEG with the device bearer and no tenant ids', async () => {
    let body: FormData | null = null;
    let authorization = '';
    const fetchFn: typeof fetch = (_url, init) => {
      authorization = new Headers(init?.headers).get('authorization') ?? '';
      body = init?.body instanceof FormData ? init.body : null;
      return Promise.resolve(
        new Response(
          JSON.stringify({ job_id: '11111111-1111-4111-8111-111111111111', status: 'QUEUED' }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      );
    };

    const created = await postDeviceTryOnJob(
      {
        secret: 'device-secret',
        sessionId: '22222222-2222-4222-8222-222222222222',
        garmentId: '33333333-3333-4333-8333-333333333333',
        variantId: '44444444-4444-4444-8444-444444444444',
        jpeg,
      },
      fetchFn,
    );

    expect(created?.job_id).toBe('11111111-1111-4111-8111-111111111111');
    expect(authorization).toBe('Bearer device-secret');
    const fields = postedFields(body);
    expect(fields.organization_id).toBeNull();
    expect(fields.shop_id).toBeNull();
    expect(fields.storage_path).toBeNull();
    expect(fields.policy_version).toBe('photo-tryon-upload-1');
    expect(fields.image).toBe(true);
  });

  it('drops a result that is not the schema the mirror understands', async () => {
    const fetchFn: typeof fetch = () =>
      Promise.resolve(
        new Response(JSON.stringify({ job: { output_path: 'secret/path.jpg' } }), { status: 200 }),
      );
    expect(
      await fetchCurrentTryOnJob(
        'device-secret',
        '22222222-2222-4222-8222-222222222222',
        undefined,
        fetchFn,
      ),
    ).toBeNull();
  });
});

function postedFields(body: unknown): {
  organization_id: string | null;
  shop_id: string | null;
  storage_path: string | null;
  policy_version: string | null;
  image: boolean;
} {
  if (!(body instanceof FormData)) {
    return {
      organization_id: 'missing',
      shop_id: 'missing',
      storage_path: 'missing',
      policy_version: null,
      image: false,
    };
  }
  const text = (name: string): string | null => {
    const value = body.get(name);
    return typeof value === 'string' ? value : null;
  };
  return {
    organization_id: text('organization_id'),
    shop_id: text('shop_id'),
    storage_path: text('storage_path'),
    policy_version: text('policy_version'),
    image: body.get('image') instanceof Blob,
  };
}
