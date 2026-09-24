/**
 * Canonical enum values for the MirrorFit AI domain.
 *
 * These arrays are the single source of truth. `@mirrorfit/validation` builds
 * Zod schemas from them and the SQL migrations mirror them as native Postgres
 * enum types, so a value can only be added in one place.
 *
 * Order is part of the contract where privilege depends on it. The database
 * side is held to these exact values and ordering by the schema parity test in
 * `apps/web/src/lib/supabase/schema-parity.test.ts`.
 */

export const STAFF_ROLES = ['ORG_OWNER', 'ADMIN', 'MANAGER', 'STAFF'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

/** Who is acting. Device identity is deliberately separate from staff auth. */
export const ACTOR_KINDS = ['STAFF', 'DEVICE', 'CUSTOMER', 'SYSTEM'] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

export const SESSION_STATUSES = ['WAITING', 'PAIRED', 'ACTIVE', 'ENDED', 'EXPIRED'] as const;
export type SessionStatus = (typeof SESSION_STATUSES)[number];

export const DEVICE_STATUSES = ['ONLINE', 'OFFLINE', 'MAINTENANCE', 'REVOKED'] as const;
export type DeviceStatus = (typeof DEVICE_STATUSES)[number];

export const INSTALLATION_STATUSES = ['ACTIVE', 'SUSPENDED', 'MAINTENANCE', 'REVOKED'] as const;
export type InstallationStatus = (typeof INSTALLATION_STATUSES)[number];

export const CUSTOMER_REQUEST_STATUSES = [
  'REQUESTED',
  'ACKNOWLEDGED',
  'FULFILLED',
  'CANCELLED',
] as const;
export type CustomerRequestStatus = (typeof CUSTOMER_REQUEST_STATUSES)[number];

export const TRYON_JOB_STATUSES = [
  'QUEUED',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
] as const;
export type TryOnJobStatus = (typeof TRYON_JOB_STATUSES)[number];

/**
 * Known garment asset kinds.
 *
 * The storage model treats this as an open vocabulary: assets are rows keyed by
 * kind rather than columns on the garment, so a new kind (mesh LODs, normal
 * maps, cloth-sim parameters) is a new row, never a schema migration.
 */
export const GARMENT_ASSET_KINDS = [
  'THUMBNAIL',
  'MOBILE_IMAGE',
  'FRONT_IMAGE',
  'BACK_IMAGE',
  'OVERLAY',
  'ALPHA_MASK',
  'SEGMENTATION_MASK',
  'DEPTH_MAP',
  'FITTING_METADATA',
  'AI_REFERENCE',
  'MESH',
  'MODEL_3D',
] as const;
export type GarmentAssetKind = (typeof GARMENT_ASSET_KINDS)[number];

export const SIZE_LABELS = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'] as const;
export type SizeLabel = (typeof SIZE_LABELS)[number];

export const CONSENT_KINDS = ['CAMERA_PROCESSING', 'PHOTO_TRYON_UPLOAD', 'ANALYTICS'] as const;
export type ConsentKind = (typeof CONSENT_KINDS)[number];

export const SUPPORTED_LOCALES = ['en', 'ar'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const RTL_LOCALES: readonly Locale[] = ['ar'];

export function isRtlLocale(locale: Locale): boolean {
  return RTL_LOCALES.includes(locale);
}
