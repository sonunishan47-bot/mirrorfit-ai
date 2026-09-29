/**
 * Pure rules for the optional photorealistic job.
 * No database and no pixels. Routes and the worker call these before I/O.
 */

export const TRYON_JOB_STATUSES = [
  'QUEUED',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
] as const;
export type TryOnJobStatusName = (typeof TRYON_JOB_STATUSES)[number];

export const TRYON_PRIVATE_BUCKET = 'tryon-private';

/** How long a customer still may sit in private storage. */
export const TRYON_INPUT_TTL_MS = 20 * 60 * 1000;

export interface TenantScope {
  readonly organizationId: string;
  readonly shopId: string;
  readonly displayId: string;
}

export interface SessionScope extends TenantScope {
  readonly sessionId: string;
  readonly status: string;
}

export function deviceMayStartTryOn(device: TenantScope, session: SessionScope): boolean {
  return (
    session.status === 'ACTIVE' &&
    session.displayId === device.displayId &&
    session.organizationId === device.organizationId &&
    session.shopId === device.shopId
  );
}

export function variantBelongsToDeviceShop(
  row: {
    readonly garmentId: string;
    readonly variantId: string;
    readonly organizationId: string;
    readonly shopId: string;
    readonly active: boolean;
  },
  device: TenantScope,
  garmentId: string,
  variantId: string,
): boolean {
  return (
    row.active &&
    row.garmentId === garmentId &&
    row.variantId === variantId &&
    row.organizationId === device.organizationId &&
    row.shopId === device.shopId
  );
}

/** A worker may finish only the job it moved to RUNNING. */
export function completionAllowed(status: string): boolean {
  return status === 'RUNNING';
}

export function claimAllowed(status: string): boolean {
  return status === 'QUEUED';
}

/**
 * Legal status moves. Anything else is rejected so a late worker cannot
 * resurrect a cancelled job or overwrite a newer selection's row.
 */
export function transitionAllowed(from: string, to: TryOnJobStatusName): boolean {
  if (from === 'QUEUED' && (to === 'RUNNING' || to === 'CANCELLED')) return true;
  if (from === 'RUNNING' && (to === 'SUCCEEDED' || to === 'FAILED' || to === 'CANCELLED')) {
    return true;
  }
  return false;
}

export function resultMatchesSelection(
  job: { readonly garmentId: string; readonly variantId: string },
  selection: { readonly garmentId: string; readonly variantId: string },
): boolean {
  return job.garmentId === selection.garmentId && job.variantId === selection.variantId;
}

export function failureNeedsCode(status: string, errorCode: string | null | undefined): boolean {
  if (status !== 'FAILED') return true;
  return (
    typeof errorCode === 'string' && errorCode.trim().length > 0 && errorCode.trim().length <= 80
  );
}

/**
 * The photoreal layer is a signed output only. Failure, timeout, a missing
 * person, or a newer garment selection keep the geometric overlay and show
 * no image. This never invents pixels.
 */
export function photorealResultVisible(input: {
  readonly outputUrl: string | null;
  readonly resultGarmentId: string | null;
  readonly resultVariantId: string | null;
  readonly selectedGarmentId: string | null;
  readonly selectedVariantId: string | null;
  readonly personPresent: boolean;
}): boolean {
  if (!input.personPresent) return false;
  if (!input.outputUrl || !input.resultGarmentId || !input.resultVariantId) return false;
  if (!input.selectedGarmentId || !input.selectedVariantId) return false;
  return resultMatchesSelection(
    { garmentId: input.resultGarmentId, variantId: input.resultVariantId },
    { garmentId: input.selectedGarmentId, variantId: input.selectedVariantId },
  );
}

/**
 * A SUCCEEDED completion is refused when the session is no longer active or a
 * newer garment job exists. The caller records FAILED instead of publishing
 * the late image.
 */
export function staleCompletionReason(input: {
  readonly sessionStatus: string;
  readonly newerSelectionExists: boolean;
}): 'SESSION_ENDED' | 'STALE_SELECTION' | null {
  if (input.sessionStatus !== 'ACTIVE') return 'SESSION_ENDED';
  if (input.newerSelectionExists) return 'STALE_SELECTION';
  return null;
}
