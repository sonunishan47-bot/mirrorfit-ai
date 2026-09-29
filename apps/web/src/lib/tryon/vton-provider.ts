import {
  validateStillDimensions,
  validateStillFraming,
  validateStillJpeg,
} from '@mirrorfit/tryon-core';
import type { GarmentFitCategory } from '@mirrorfit/types';

/**
 * Vendor-neutral photorealistic boundary.
 *
 * The mirror never calls a GPU. A worker process calls `generateStill` against
 * WORKER_ENDPOINT_URL (RUNPOD_ENDPOINT_URL remains a legacy alias). This module
 * never synthesizes an image.
 *
 * Known research checkpoints are refused for a shop unless
 * MODEL_ALLOW_NONCOMMERCIAL=1. That flag is a private experiment switch, not a
 * license.
 */

export type VtonProviderStatus = 'not_connected' | 'configured';

export type VtonFitCategory = GarmentFitCategory;

export const VTON_NOT_CONNECTED = 'VTON_NOT_CONNECTED' as const;

export const VTON_ERROR_CODES = [
  'VTON_NOT_CONNECTED',
  'VTON_UPSTREAM',
  'GARMENT_REFERENCE_MISSING',
  'CATEGORY_UNSUPPORTED',
  'MODEL_LICENSE_BLOCKED',
  'INVALID_OUTPUT',
] as const;

export type VtonErrorCode = (typeof VTON_ERROR_CODES)[number];

export interface VtonEnv {
  readonly [key: string]: string | undefined;
}

export interface VtonModelInfo {
  readonly provider: string;
  readonly name: string | null;
  readonly version: string | null;
  /** False for known non-commercial checkpoints. Null means a private server. */
  readonly commercialUse: boolean | null;
  readonly videoCapable: boolean;
}

export interface VtonCapabilities {
  /** The live pipeline sends one still. Video is not uploaded from the mirror. */
  readonly activeMode: 'still';
  readonly videoCapable: boolean;
  readonly fitCategories: readonly VtonFitCategory[];
  readonly commercialUse: boolean | null;
  readonly connected: boolean;
}

export interface VtonProviderConfig {
  readonly status: VtonProviderStatus;
  readonly endpointUrl: string | null;
  readonly workerSecret: string | null;
  readonly model: VtonModelInfo;
}

interface ModelProfile {
  readonly provider: string;
  readonly fitCategories: readonly VtonFitCategory[];
  readonly videoCapable: boolean;
  readonly commercialUse: false;
}

/**
 * Profiles are capability gates, not downloads. Weights are not in this repo.
 * Licenses checked September 2026: CatVTON and CatV2TON are CC BY-NC-SA 4.0,
 * IDM-VTON is CC BY-NC-SA 4.0, OOTDiffusion is CC BY-NC-SA 4.0, Qwen-Image-2.1
 * is research-only. None of them are enabled for a shop by default.
 */
const MODEL_PROFILES: Readonly<Record<string, ModelProfile>> = {
  catvton: {
    provider: 'catvton',
    fitCategories: ['TOP', 'LOWER_BODY', 'FULL_BODY'],
    videoCapable: false,
    commercialUse: false,
  },
  'idm-vton': {
    provider: 'idm-vton',
    fitCategories: ['TOP'],
    videoCapable: false,
    commercialUse: false,
  },
  ootdiffusion: {
    provider: 'ootdiffusion',
    fitCategories: ['TOP', 'FULL_BODY'],
    videoCapable: false,
    commercialUse: false,
  },
  catv2ton: {
    provider: 'catv2ton',
    fitCategories: ['TOP', 'LOWER_BODY', 'FULL_BODY'],
    videoCapable: true,
    commercialUse: false,
  },
  'qwen-image-2.1': {
    provider: 'qwen-image',
    fitCategories: ['TOP', 'LOWER_BODY', 'FULL_BODY'],
    videoCapable: false,
    commercialUse: false,
  },
};

const ALL_FITS: readonly VtonFitCategory[] = ['TOP', 'LOWER_BODY', 'FULL_BODY'];

export function readVtonProviderConfig(env: VtonEnv = process.env): VtonProviderConfig {
  const endpoint = workerEndpoint(env);
  const secret = env['WORKER_SECRET']?.trim() ?? '';
  const endpointUrl = /^https?:\/\//.test(endpoint) ? endpoint : null;
  return {
    status: endpointUrl ? 'configured' : 'not_connected',
    endpointUrl,
    workerSecret: secret.length >= 16 ? secret : null,
    model: modelInfo(env),
  };
}

export function modelInfo(env: VtonEnv = process.env): VtonModelInfo {
  const name = env['MODEL_NAME']?.trim().toLowerCase() || null;
  const profile = name ? MODEL_PROFILES[name] : undefined;
  const provider = env['MODEL_PROVIDER']?.trim() || profile?.provider || 'private';
  const version = env['MODEL_VERSION']?.trim() || null;
  return {
    provider,
    name,
    version,
    commercialUse: profile ? profile.commercialUse : null,
    videoCapable: profile ? profile.videoCapable : false,
  };
}

export function vtonCapabilities(env: VtonEnv = process.env): VtonCapabilities {
  const config = readVtonProviderConfig(env);
  const name = config.model.name;
  const profile = name ? MODEL_PROFILES[name] : undefined;
  return {
    activeMode: 'still',
    videoCapable: config.model.videoCapable,
    fitCategories: profile ? profile.fitCategories : ALL_FITS,
    commercialUse: config.model.commercialUse,
    connected: config.status === 'configured',
  };
}

export function categoryAllowed(
  fit: VtonFitCategory | null,
  capabilities: VtonCapabilities,
): boolean {
  if (!fit) return false;
  return capabilities.fitCategories.includes(fit);
}

export interface StillInferenceJob {
  readonly jobId: string;
  readonly personUrl: string;
  readonly garmentUrl: string | null;
  readonly garmentCategory: string | null;
  readonly fitCategory: VtonFitCategory | null;
}

/** JSON a private model server must accept. No secrets and no raw pixels. */
export function buildStillInferenceBody(
  job: StillInferenceJob,
  model: VtonModelInfo,
): {
  readonly job_id: string;
  readonly mode: 'still';
  readonly person_url: string;
  readonly garment_url: string;
  readonly garment_category: string | null;
  readonly fit_category: VtonFitCategory | null;
  readonly model: {
    readonly provider: string;
    readonly name: string | null;
    readonly version: string | null;
  };
} {
  return {
    job_id: job.jobId,
    mode: 'still',
    person_url: job.personUrl,
    garment_url: job.garmentUrl ?? '',
    garment_category: job.garmentCategory,
    fit_category: job.fitCategory,
    model: {
      provider: model.provider,
      name: model.name,
      version: model.version,
    },
  };
}

export function preflightStill(
  job: StillInferenceJob,
  env: VtonEnv = process.env,
): { readonly ok: true } | { readonly ok: false; readonly error: VtonErrorCode } {
  const config = readVtonProviderConfig(env);
  if (config.status !== 'configured' || !config.endpointUrl) {
    return { ok: false, error: 'VTON_NOT_CONNECTED' };
  }
  if (config.model.commercialUse === false && env['MODEL_ALLOW_NONCOMMERCIAL'] !== '1') {
    return { ok: false, error: 'MODEL_LICENSE_BLOCKED' };
  }
  if (!job.garmentUrl) return { ok: false, error: 'GARMENT_REFERENCE_MISSING' };
  if (!categoryAllowed(job.fitCategory, vtonCapabilities(env))) {
    return { ok: false, error: 'CATEGORY_UNSUPPORTED' };
  }
  return { ok: true };
}

export function vtonHealthUrl(endpointUrl: string): string | null {
  try {
    const url = new URL(endpointUrl);
    url.pathname = '/health';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

export async function probeVtonHealth(
  env: VtonEnv = process.env,
  fetchFn: typeof fetch = fetch,
): Promise<{ readonly ok: boolean; readonly reason: string }> {
  const config = readVtonProviderConfig(env);
  if (!config.endpointUrl) return { ok: false, reason: 'not_connected' };
  const healthUrl = vtonHealthUrl(config.endpointUrl);
  if (!healthUrl) return { ok: false, reason: 'not_connected' };
  try {
    const response = await fetchFn(healthUrl, { signal: AbortSignal.timeout(3_000) });
    if (!response.ok) return { ok: false, reason: 'unreachable' };
    return { ok: true, reason: 'ok' };
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
}

/**
 * One still inference. Returns upstream JPEG bytes or an error code.
 * Does not draw, decode into a person, or substitute a garment overlay.
 */
export async function generateStill(
  job: StillInferenceJob,
  env: VtonEnv = process.env,
  fetchFn: typeof fetch = fetch,
): Promise<
  | { readonly ok: true; readonly jpeg: Uint8Array }
  | { readonly ok: false; readonly error: VtonErrorCode }
> {
  const ready = preflightStill(job, env);
  if (!ready.ok) return ready;
  const endpoint = readVtonProviderConfig(env).endpointUrl;
  if (!endpoint) return { ok: false, error: 'VTON_NOT_CONNECTED' };
  try {
    const response = await fetchFn(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'image/jpeg' },
      body: JSON.stringify(buildStillInferenceBody(job, modelInfo(env))),
      signal: AbortSignal.timeout(18_000),
    });
    const type = response.headers.get('content-type') ?? '';
    if (!response.ok || !type.includes('image/jpeg')) {
      return { ok: false, error: 'VTON_UPSTREAM' };
    }
    const jpeg = new Uint8Array(await response.arrayBuffer());
    const dimensions = validateStillDimensions(jpeg);
    if (!validateStillJpeg(jpeg).ok || !dimensions.ok) {
      return { ok: false, error: 'INVALID_OUTPUT' };
    }
    if (!validateStillFraming(dimensions.width, dimensions.height).ok) {
      return { ok: false, error: 'INVALID_OUTPUT' };
    }
    return { ok: true, jpeg };
  } catch {
    return { ok: false, error: 'VTON_UPSTREAM' };
  }
}

/** Drops URLs and bearer tokens before anything is written to a log. */
export function safeTryOnLog(message: string): string {
  return message
    .replace(/bearer\s+\S+/gi, 'bearer [redacted]')
    .replace(/https?:\/\/\S+/gi, '[url]')
    .slice(0, 200);
}

function workerEndpoint(env: VtonEnv): string {
  const generic = env['WORKER_ENDPOINT_URL']?.trim() ?? '';
  if (generic) return generic;
  return env['RUNPOD_ENDPOINT_URL']?.trim() ?? '';
}
