import { validateStillJpeg, STILL_MAX_BYTES, STILL_MIN_BYTES } from '@mirrorfit/tryon-core';
import { tryOnJobCreateFieldsSchema, workerTryOnCompleteFieldsSchema } from '@mirrorfit/validation';

export interface DeviceTryOnRequest {
  readonly sessionId: string;
  readonly garmentId: string;
  readonly variantId: string;
  readonly policyVersion: string;
  readonly jpeg: Uint8Array;
}

export async function readDeviceTryOnRequest(
  request: Request,
): Promise<{ ok: true; data: DeviceTryOnRequest } | { ok: false }> {
  const form = await readForm(request);
  if (!form) return { ok: false };
  const parsed = tryOnJobCreateFieldsSchema.safeParse({
    session_id: form.get('session_id'),
    garment_id: form.get('garment_id'),
    variant_id: form.get('variant_id'),
    policy_version: form.get('policy_version'),
  });
  if (!parsed.success) return { ok: false };
  const jpeg = await readJpeg(form.get('image'));
  if (!jpeg) return { ok: false };
  return {
    ok: true,
    data: {
      sessionId: parsed.data.session_id,
      garmentId: parsed.data.garment_id,
      variantId: parsed.data.variant_id,
      policyVersion: parsed.data.policy_version,
      jpeg,
    },
  };
}

export async function readWorkerCompleteRequest(request: Request): Promise<
  | {
      ok: true;
      jobId: string;
      status: 'SUCCEEDED' | 'FAILED';
      errorCode: string | null;
      jpeg: Uint8Array | null;
    }
  | { ok: false }
> {
  const form = await readForm(request);
  if (!form) return { ok: false };
  const errorField = form.get('error_code');
  const parsed = workerTryOnCompleteFieldsSchema.safeParse({
    job_id: form.get('job_id'),
    status: form.get('status'),
    ...(typeof errorField === 'string' && errorField.trim() ? { error_code: errorField } : {}),
  });
  if (!parsed.success) return { ok: false };
  const image = form.get('image');
  const jpeg = image == null || image === '' ? null : await readJpeg(image);
  if (parsed.data.status === 'SUCCEEDED' && !jpeg) return { ok: false };
  if (parsed.data.status === 'FAILED' && image instanceof Blob && image.size > 0 && !jpeg) {
    return { ok: false };
  }
  return {
    ok: true,
    jobId: parsed.data.job_id,
    status: parsed.data.status,
    errorCode: parsed.data.error_code ?? null,
    jpeg,
  };
}

async function readForm(request: Request): Promise<FormData | null> {
  try {
    return await request.formData();
  } catch {
    return null;
  }
}

async function readJpeg(value: FormDataEntryValue | null): Promise<Uint8Array | null> {
  if (!(value instanceof Blob)) return null;
  if (value.size < STILL_MIN_BYTES || value.size > STILL_MAX_BYTES) return null;
  if (value.type && value.type !== 'image/jpeg' && value.type !== 'application/octet-stream') {
    return null;
  }
  const jpeg = new Uint8Array(await value.arrayBuffer());
  return validateStillJpeg(jpeg).ok ? jpeg : null;
}
