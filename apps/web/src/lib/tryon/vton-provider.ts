/**
 * Photorealistic provider boundary.
 *
 * STATUS: NOT CONNECTED unless RUNPOD_ENDPOINT_URL is set in the server
 * environment. This module never synthesizes an image. The browser must not
 * import it; the worker process is the only caller of the endpoint.
 */

export type VtonProviderStatus = 'not_connected' | 'configured';

export interface VtonProviderConfig {
  readonly status: VtonProviderStatus;
  readonly endpointUrl: string | null;
  readonly workerSecret: string | null;
}

export interface VtonEnv {
  readonly [key: string]: string | undefined;
}

export function readVtonProviderConfig(env: VtonEnv = process.env): VtonProviderConfig {
  const endpoint = env['RUNPOD_ENDPOINT_URL']?.trim() ?? '';
  const secret = env['WORKER_SECRET']?.trim() ?? '';
  const endpointUrl = /^https?:\/\//.test(endpoint) ? endpoint : null;
  return {
    status: endpointUrl ? 'configured' : 'not_connected',
    endpointUrl,
    workerSecret: secret.length >= 16 ? secret : null,
  };
}

export const VTON_NOT_CONNECTED = 'VTON_NOT_CONNECTED' as const;
