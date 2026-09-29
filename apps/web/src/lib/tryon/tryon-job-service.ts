import 'server-only';

import { validateStillJpeg } from '@mirrorfit/tryon-core';

import type { ClientErrorCode } from '@/lib/api/errors';
import { garmentAssetObjectPath } from '@/lib/catalog/garment-asset-storage';
import type { DeviceContext } from '@/lib/device/authenticate';
import { createSupabaseAdminClient } from '@/lib/supabase/admin-client';

import {
  TRYON_INPUT_TTL_MS,
  TRYON_PRIVATE_BUCKET,
  claimAllowed,
  completionAllowed,
  deviceMayStartTryOn,
  failureNeedsCode,
  transitionAllowed,
  variantBelongsToDeviceShop,
} from './tryon-job-policy';
import { readVtonProviderConfig } from './vton-provider';

const SIGNED_URL_TTL_SECONDS = 120;

type AdminClient = ReturnType<typeof createSupabaseAdminClient>;

export interface CreatedTryOnJob {
  readonly jobId: string;
  readonly status: 'QUEUED';
}

export async function createDeviceTryOnJob(input: {
  readonly device: DeviceContext;
  readonly sessionId: string;
  readonly garmentId: string;
  readonly variantId: string;
  readonly policyVersion: string;
  readonly jpeg: Uint8Array;
}): Promise<{ ok: true; job: CreatedTryOnJob } | { ok: false; error: ClientErrorCode }> {
  const jpegCheck = validateStillJpeg(input.jpeg);
  if (!jpegCheck.ok) return { ok: false, error: 'INVALID_REQUEST' };
  if (!input.policyVersion.trim()) return { ok: false, error: 'INVALID_REQUEST' };

  const supabase = createSupabaseAdminClient();
  const session = await loadSession(supabase, input.sessionId);
  if (!session || !deviceMayStartTryOn(input.device, session)) {
    return { ok: false, error: 'INVALID_REQUEST' };
  }

  const variant = await loadVariant(supabase, input.garmentId, input.variantId);
  if (
    !variant ||
    !variantBelongsToDeviceShop(variant, input.device, input.garmentId, input.variantId)
  ) {
    return { ok: false, error: 'INVALID_REQUEST' };
  }

  const consentId = await grantPhotoConsent(supabase, session, input.policyVersion);
  if (!consentId) return { ok: false, error: 'INVALID_REQUEST' };

  const jobId = crypto.randomUUID();
  let inputPath: string;
  try {
    inputPath = garmentAssetObjectPath(
      session.organizationId,
      session.shopId,
      'tryon',
      session.sessionId,
      `${jobId}.jpg`,
    );
  } catch {
    return { ok: false, error: 'INTERNAL' };
  }

  const uploaded = await supabase.storage
    .from(TRYON_PRIVATE_BUCKET)
    .upload(inputPath, jpegBlob(input.jpeg), {
      contentType: 'image/jpeg',
      upsert: false,
    });
  if (uploaded.error) return { ok: false, error: 'INTERNAL' };

  const now = new Date();
  const { error: cancelError } = await supabase
    .from('tryon_jobs')
    .update({
      status: 'CANCELLED',
      finished_at: now.toISOString(),
      error_code: 'SUPERSEDED',
    })
    .eq('session_id', session.sessionId)
    .eq('status', 'QUEUED');
  if (cancelError) {
    await supabase.storage.from(TRYON_PRIVATE_BUCKET).remove([inputPath]);
    return { ok: false, error: 'INTERNAL' };
  }

  const { error: insertError } = await supabase.from('tryon_jobs').insert({
    id: jobId,
    organization_id: session.organizationId,
    shop_id: session.shopId,
    session_id: session.sessionId,
    garment_id: input.garmentId,
    variant_id: input.variantId,
    consent_id: consentId,
    status: 'QUEUED',
    input_path: inputPath,
    input_expires_at: new Date(now.getTime() + TRYON_INPUT_TTL_MS).toISOString(),
    queued_at: now.toISOString(),
  });
  if (insertError) {
    await supabase.storage.from(TRYON_PRIVATE_BUCKET).remove([inputPath]);
    return { ok: false, error: 'INTERNAL' };
  }

  return { ok: true, job: { jobId, status: 'QUEUED' } };
}

export interface CurrentTryOnJob {
  readonly job_id: string;
  readonly status: string;
  readonly error_code: string | null;
  readonly garment_id: string;
  readonly variant_id: string;
  readonly output_url: string | null;
  readonly expires_in: number | null;
  readonly vton_provider: 'not_connected' | 'configured';
}

export async function readCurrentTryOnJob(input: {
  readonly device: DeviceContext;
  readonly sessionId: string;
}): Promise<{ ok: true; job: CurrentTryOnJob | null } | { ok: false; error: ClientErrorCode }> {
  const supabase = createSupabaseAdminClient();
  const session = await loadSession(supabase, input.sessionId);
  if (
    !session ||
    session.displayId !== input.device.displayId ||
    session.organizationId !== input.device.organizationId ||
    session.shopId !== input.device.shopId
  ) {
    return { ok: false, error: 'INVALID_REQUEST' };
  }

  await purgeExpiredTryOnAssets(supabase);

  const { data, error } = await supabase
    .from('tryon_jobs')
    .select('id, status, error_code, garment_id, variant_id, output_path')
    .eq('session_id', session.sessionId)
    .order('queued_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return { ok: false, error: 'INTERNAL' };
  if (!data) {
    return { ok: true, job: null };
  }

  let outputUrl: string | null = null;
  if (data.status === 'SUCCEEDED' && data.output_path && session.status === 'ACTIVE') {
    const signed = await supabase.storage
      .from(TRYON_PRIVATE_BUCKET)
      .createSignedUrl(data.output_path, SIGNED_URL_TTL_SECONDS);
    outputUrl = signed.data?.signedUrl ?? null;
  }

  return {
    ok: true,
    job: {
      job_id: data.id,
      status: data.status,
      error_code: data.error_code,
      garment_id: data.garment_id,
      variant_id: data.variant_id,
      output_url: outputUrl,
      expires_in: outputUrl ? SIGNED_URL_TTL_SECONDS : null,
      vton_provider: readVtonProviderConfig().status,
    },
  };
}

export async function purgeTryOnAssetsForSession(sessionId: string): Promise<void> {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from('tryon_jobs')
    .select('id, input_path, output_path')
    .eq('session_id', sessionId);
  if (error || !data) return;
  await deleteJobFiles(supabase, data);
}

export async function claimNextTryOnJob(): Promise<
  | { ok: true; job: null }
  | {
      ok: true;
      job: {
        job_id: string;
        session_id: string;
        garment_id: string;
        variant_id: string;
        input_url: string;
        garment_reference_url: string | null;
        vton_provider: 'not_connected' | 'configured';
      };
    }
  | { ok: false; error: ClientErrorCode }
> {
  const supabase = createSupabaseAdminClient();
  await purgeExpiredTryOnAssets(supabase);
  const { data: queued, error } = await supabase
    .from('tryon_jobs')
    .select('id, status, session_id, garment_id, variant_id, input_path, organization_id')
    .eq('status', 'QUEUED')
    .order('queued_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) return { ok: false, error: 'INTERNAL' };
  if (!queued || !claimAllowed(queued.status) || !queued.input_path) return { ok: true, job: null };

  const started = new Date().toISOString();
  const { data: running, error: updateError } = await supabase
    .from('tryon_jobs')
    .update({ status: 'RUNNING', started_at: started })
    .eq('id', queued.id)
    .eq('status', 'QUEUED')
    .select('id')
    .maybeSingle();
  if (updateError) return { ok: false, error: 'INTERNAL' };
  if (!running || !transitionAllowed('QUEUED', 'RUNNING')) return { ok: true, job: null };

  const signed = await supabase.storage
    .from(TRYON_PRIVATE_BUCKET)
    .createSignedUrl(queued.input_path, SIGNED_URL_TTL_SECONDS);
  if (!signed.data?.signedUrl) {
    await supabase
      .from('tryon_jobs')
      .update({
        status: 'FAILED',
        error_code: 'INPUT_UNAVAILABLE',
        finished_at: new Date().toISOString(),
      })
      .eq('id', queued.id)
      .eq('status', 'RUNNING');
    return { ok: false, error: 'INTERNAL' };
  }

  const reference = await signAiReference(
    supabase,
    queued.organization_id,
    queued.garment_id,
    queued.variant_id,
  );

  return {
    ok: true,
    job: {
      job_id: queued.id,
      session_id: queued.session_id,
      garment_id: queued.garment_id,
      variant_id: queued.variant_id,
      input_url: signed.data.signedUrl,
      garment_reference_url: reference,
      vton_provider: readVtonProviderConfig().status,
    },
  };
}

export async function completeTryOnJob(input: {
  readonly jobId: string;
  readonly status: 'SUCCEEDED' | 'FAILED';
  readonly errorCode?: string | null;
  readonly jpeg?: Uint8Array | null;
}): Promise<{ ok: true } | { ok: false; error: ClientErrorCode }> {
  if (!failureNeedsCode(input.status, input.errorCode))
    return { ok: false, error: 'INVALID_REQUEST' };
  if (input.status === 'SUCCEEDED') {
    if (!input.jpeg || !validateStillJpeg(input.jpeg).ok)
      return { ok: false, error: 'INVALID_REQUEST' };
  }

  const supabase = createSupabaseAdminClient();
  const { data: job, error } = await supabase
    .from('tryon_jobs')
    .select('id, status, session_id, organization_id, shop_id')
    .eq('id', input.jobId)
    .maybeSingle();
  if (error || !job) return { ok: false, error: 'INVALID_REQUEST' };
  if (!completionAllowed(job.status) || !transitionAllowed(job.status, input.status)) {
    return { ok: false, error: 'INVALID_REQUEST' };
  }

  let outputPath: string | null = null;
  if (input.status === 'SUCCEEDED' && input.jpeg) {
    outputPath = garmentAssetObjectPath(
      job.organization_id,
      job.shop_id,
      'tryon',
      job.session_id,
      `${job.id}-out.jpg`,
    );
    const uploaded = await supabase.storage
      .from(TRYON_PRIVATE_BUCKET)
      .upload(outputPath, jpegBlob(input.jpeg), {
        contentType: 'image/jpeg',
        upsert: false,
      });
    if (uploaded.error) return { ok: false, error: 'INTERNAL' };
  }

  const { data: updated, error: updateError } = await supabase
    .from('tryon_jobs')
    .update({
      status: input.status,
      error_code: input.status === 'FAILED' ? input.errorCode!.trim() : null,
      output_path: outputPath,
      finished_at: new Date().toISOString(),
    })
    .eq('id', job.id)
    .eq('status', 'RUNNING')
    .select('id')
    .maybeSingle();
  if (updateError || !updated) {
    if (outputPath) await supabase.storage.from(TRYON_PRIVATE_BUCKET).remove([outputPath]);
    return { ok: false, error: 'INVALID_REQUEST' };
  }
  return { ok: true };
}

async function loadSession(supabase: AdminClient, sessionId: string) {
  const { data, error } = await supabase
    .from('sessions')
    .select('id, status, display_id, organization_id, shop_id')
    .eq('id', sessionId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    sessionId: data.id,
    status: data.status,
    displayId: data.display_id,
    organizationId: data.organization_id,
    shopId: data.shop_id,
  };
}

async function loadVariant(supabase: AdminClient, garmentId: string, variantId: string) {
  const { data, error } = await supabase
    .from('garment_variants')
    .select('id, garment_id, organization_id, shop_id, is_active')
    .eq('id', variantId)
    .eq('garment_id', garmentId)
    .maybeSingle();
  if (error || !data) return null;
  return {
    garmentId: data.garment_id,
    variantId: data.id,
    organizationId: data.organization_id,
    shopId: data.shop_id,
    active: data.is_active,
  };
}

async function grantPhotoConsent(
  supabase: AdminClient,
  session: { sessionId: string; organizationId: string; shopId: string },
  policyVersion: string,
): Promise<string | null> {
  const { data: existing, error } = await supabase
    .from('consents')
    .select('id, granted, revoked_at')
    .eq('session_id', session.sessionId)
    .eq('kind', 'PHOTO_TRYON_UPLOAD')
    .maybeSingle();
  if (error) return null;
  if (existing?.revoked_at) return null;
  if (existing?.granted) return existing.id;

  if (existing) {
    const { data: updated, error: updateError } = await supabase
      .from('consents')
      .update({
        granted: true,
        revoked_at: null,
        policy_version: policyVersion,
        granted_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .select('id')
      .maybeSingle();
    if (updateError || !updated) return null;
    return updated.id;
  }

  const { data: inserted, error: insertError } = await supabase
    .from('consents')
    .insert({
      organization_id: session.organizationId,
      shop_id: session.shopId,
      session_id: session.sessionId,
      kind: 'PHOTO_TRYON_UPLOAD',
      granted: true,
      policy_version: policyVersion,
    })
    .select('id')
    .maybeSingle();
  if (inserted) return inserted.id;

  const { data: raced } = await supabase
    .from('consents')
    .select('id, granted, revoked_at')
    .eq('session_id', session.sessionId)
    .eq('kind', 'PHOTO_TRYON_UPLOAD')
    .maybeSingle();
  if (insertError && raced?.granted && !raced.revoked_at) return raced.id;
  return null;
}

async function signAiReference(
  supabase: AdminClient,
  organizationId: string,
  garmentId: string,
  variantId: string,
): Promise<string | null> {
  if (!/^[0-9a-f-]{36}$/i.test(variantId)) return null;
  const { data, error } = await supabase
    .from('garment_assets')
    .select('variant_id, storage_bucket, storage_path, version')
    .eq('garment_id', garmentId)
    .eq('organization_id', organizationId)
    .eq('kind', 'AI_REFERENCE')
    .or(`variant_id.eq.${variantId},variant_id.is.null`)
    .order('version', { ascending: false });
  if (error || !data || data.length === 0) return null;
  const preferred =
    data.find((row) => row.variant_id === variantId) ?? data.find((row) => row.variant_id === null);
  if (!preferred) return null;
  const signed = await supabase.storage
    .from(preferred.storage_bucket)
    .createSignedUrl(preferred.storage_path, SIGNED_URL_TTL_SECONDS);
  return signed.data?.signedUrl ?? null;
}

export async function sweepTryOnAssets(): Promise<void> {
  try {
    const supabase = createSupabaseAdminClient();
    await purgeExpiredTryOnAssets(supabase);
  } catch {
    // Cleanup must not take down heartbeat, session create, or the mirror poll.
  }
}

async function purgeExpiredTryOnAssets(supabase: AdminClient): Promise<void> {
  const { data, error } = await supabase
    .from('tryon_jobs')
    .select('id, session_id, input_path, output_path, input_expires_at')
    .not('input_expires_at', 'is', null)
    .order('input_expires_at', { ascending: true })
    .limit(20);
  if (error || !data || data.length === 0) return;

  const now = Date.now();
  const sessionIds = [...new Set(data.map((row) => row.session_id))];
  const { data: sessions } = await supabase
    .from('sessions')
    .select('id, status')
    .in('id', sessionIds);
  const inactive = new Set(
    (sessions ?? [])
      .filter((row) => row.status === 'ENDED' || row.status === 'EXPIRED')
      .map((row) => row.id),
  );
  const due = data.filter((row) => {
    const expired = row.input_expires_at !== null && Date.parse(row.input_expires_at) <= now;
    return (expired || inactive.has(row.session_id)) && (row.input_path || row.output_path);
  });
  if (due.length === 0) return;
  await deleteJobFiles(supabase, due);
}

async function deleteJobFiles(
  supabase: AdminClient,
  rows: readonly { id: string; input_path: string | null; output_path: string | null }[],
): Promise<void> {
  const paths = rows.flatMap((row) =>
    [row.input_path, row.output_path].filter((path): path is string => !!path),
  );
  if (paths.length > 0) {
    const removed = await supabase.storage.from(TRYON_PRIVATE_BUCKET).remove(paths);
    if (removed.error) return;
  }
  for (const row of rows) {
    await supabase
      .from('tryon_jobs')
      .update({ input_path: null, output_path: null, input_expires_at: null })
      .eq('id', row.id);
  }
}

function jpegBlob(bytes: Uint8Array): Blob {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return new Blob([copy], { type: 'image/jpeg' });
}
