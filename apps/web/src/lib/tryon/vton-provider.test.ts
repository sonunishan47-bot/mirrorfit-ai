import { describe, expect, it } from 'vitest';

import { readVtonProviderConfig, VTON_NOT_CONNECTED } from './vton-provider';

describe('VTON provider boundary', () => {
  it('stays NOT CONNECTED when no RunPod endpoint is configured', () => {
    const config = readVtonProviderConfig({});
    expect(config.status).toBe('not_connected');
    expect(config.endpointUrl).toBeNull();
    expect(VTON_NOT_CONNECTED).toBe('VTON_NOT_CONNECTED');
  });

  it('is configured only with an http(s) endpoint and a long worker secret', () => {
    const config = readVtonProviderConfig({
      RUNPOD_ENDPOINT_URL: 'https://pod.example/infer',
      WORKER_SECRET: '0123456789abcdef',
    });
    expect(config.status).toBe('configured');
    expect(config.workerSecret).toBe('0123456789abcdef');
    expect(readVtonProviderConfig({ RUNPOD_ENDPOINT_URL: 'not a url' }).status).toBe(
      'not_connected',
    );
  });
});
