-- MirrorFit AI - foundation
--
-- Private schema, enum vocabulary, and the shared updated_at trigger.
--
-- Enum values mirror the const arrays in `@mirrorfit/types` exactly. That
-- package is the single source of truth; adding a value means editing the
-- array and shipping an `alter type ... add value` migration, never editing
-- one side alone.

-- ---------------------------------------------------------------------------
-- Private schema for security-definer helpers.
--
-- Deliberately not `public`: anything in an exposed schema is reachable
-- through the Data API, and a security-definer function that bypasses RLS
-- must never be callable by a client.
-- ---------------------------------------------------------------------------
create schema if not exists app;

revoke all on schema app from anon, authenticated;
grant usage on schema app to service_role;

-- ---------------------------------------------------------------------------
-- Enum vocabulary
-- ---------------------------------------------------------------------------

create type public.staff_role as enum ('ORG_OWNER', 'ADMIN', 'MANAGER', 'STAFF');

create type public.actor_kind as enum ('STAFF', 'DEVICE', 'CUSTOMER', 'SYSTEM');

create type public.session_status as enum ('WAITING', 'PAIRED', 'ACTIVE', 'ENDED', 'EXPIRED');

create type public.session_end_reason as enum (
  'CUSTOMER_ENDED',
  'TIMEOUT',
  'DISCONNECTED',
  'STAFF_RESET',
  'ERROR'
);

create type public.device_status as enum ('ONLINE', 'OFFLINE', 'MAINTENANCE', 'REVOKED');

create type public.installation_status as enum (
  'ACTIVE',
  'SUSPENDED',
  'MAINTENANCE',
  'REVOKED'
);

create type public.customer_request_status as enum (
  'REQUESTED',
  'ACKNOWLEDGED',
  'FULFILLED',
  'CANCELLED'
);

create type public.tryon_job_status as enum (
  'QUEUED',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED'
);

create type public.size_label as enum ('XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL');

create type public.consent_kind as enum (
  'CAMERA_PROCESSING',
  'PHOTO_TRYON_UPLOAD',
  'ANALYTICS'
);

-- Open vocabulary by design: a new asset kind (mesh LOD, normal map, cloth
-- parameters) is one `alter type ... add value`, never a table redesign,
-- because assets are rows keyed by kind rather than columns on the garment.
create type public.garment_asset_kind as enum (
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
  'MODEL_3D'
);

-- ---------------------------------------------------------------------------
-- Shared trigger: maintain updated_at
--
-- Set by the database rather than the application so a direct SQL fix or a
-- background job cannot leave a stale timestamp behind.
-- ---------------------------------------------------------------------------
create or replace function app.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function app.set_updated_at() is
  'Trigger function: stamps updated_at on every UPDATE.';
