/**
 * Mirror-only client for the optional still try-on.
 * The phone catalog must not import this. It sends the device bearer, never
 * an organization id, and never a storage path.
 */

import { PHOTO_TRYON_POLICY_VERSION } from '@mirrorfit/tryon-core';
import {
  currentTryOnJobResponseSchema,
  tryOnJobQueuedResponseSchema,
  type CurrentTryOnJob,
} from '@mirrorfit/validation';

export async function postDeviceTryOnJob(
  input: {
    readonly secret: string;
    readonly sessionId: string;
    readonly garmentId: string;
    readonly variantId: string;
    readonly jpeg: Uint8Array;
    readonly signal?: AbortSignal;
  },
  fetchFn: typeof fetch = fetch,
): Promise<{ readonly job_id: string } | null> {
  if (!input.secret || !input.sessionId) return null;
  const form = new FormData();
  form.set('session_id', input.sessionId);
  form.set('garment_id', input.garmentId);
  form.set('variant_id', input.variantId);
  form.set('policy_version', PHOTO_TRYON_POLICY_VERSION);
  const copy = new ArrayBuffer(input.jpeg.byteLength);
  new Uint8Array(copy).set(input.jpeg);
  form.set('image', new Blob([copy], { type: 'image/jpeg' }), 'still.jpg');

  try {
    const response = await fetchFn('/api/device/tryon-jobs', {
      method: 'POST',
      headers: { authorization: `Bearer ${input.secret}` },
      body: form,
      cache: 'no-store',
      ...(input.signal ? { signal: input.signal } : {}),
    });
    if (!response.ok) return null;
    const parsed = tryOnJobQueuedResponseSchema.safeParse(await response.json());
    return parsed.success ? { job_id: parsed.data.job_id } : null;
  } catch {
    return null;
  }
}

export async function fetchCurrentTryOnJob(
  secret: string,
  sessionId: string,
  signal?: AbortSignal,
  fetchFn: typeof fetch = fetch,
): Promise<CurrentTryOnJob | null | 'none'> {
  if (!secret || !sessionId) return null;
  try {
    const params = new URLSearchParams({ session_id: sessionId });
    const response = await fetchFn(`/api/device/tryon-jobs/current?${params.toString()}`, {
      headers: { authorization: `Bearer ${secret}` },
      cache: 'no-store',
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) return null;
    const parsed = currentTryOnJobResponseSchema.safeParse(await response.json());
    if (!parsed.success) return null;
    return parsed.data.job ?? 'none';
  } catch {
    return null;
  }
}
