-- MirrorFit AI - private garment-assets Storage bucket
--
-- Problem
-- -------
-- The catalog stores storage_bucket / storage_path on public.garment_assets and
-- the kiosk mints short-lived signed URLs via the service role
-- (resolve-garment-overlay.ts). No Storage bucket or policies existed in
-- migrations or on the linked project, so commercial overlays could not load
-- and a dashboard-created public bucket would be an easy misconfiguration.
--
-- Model
-- -----
-- * Private bucket garment-assets (matches the schema default).
-- * Explicit deny policies for anon and authenticated on this bucket
--   (USING / WITH CHECK false). service_role bypasses RLS and remains the
--   only path for createSignedUrl after device auth on
--   /api/device/garment-overlay.
-- * Object path convention (defense in depth for future uploads):
--     {organization_id}/{shop_id}/...
--   Legacy fixture metadata paths such as fixtures/<sku>.json remain valid
--   as database pointers; they are not required to exist as Storage objects.
--
-- MIME / size
-- -----------
-- Overlay drawing accepts image/png and image/webp only. JPEG is also allowed
-- on the bucket so catalog THUMBNAIL / MOBILE_IMAGE assets can share it.
-- 32 MiB covers high-resolution transparent overlays without inventing a
-- tiny limit that would reject real retail PNGs.

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'garment-assets',
  'garment-assets',
  false,
  33554432, -- 32 MiB
  array['image/png', 'image/webp', 'image/jpeg']::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types,
  updated_at = now();

-- Explicit non-access policies for the garment-assets bucket.
-- Postgres RLS is deny-by-default when no policy matches; these USING (false)
-- policies document intent and block accidental future "open" policies from
-- being the only row for this bucket without review.
--
-- service_role bypasses RLS and continues to createSignedUrl for the kiosk.

drop policy if exists "garment_assets_anon_select_deny" on storage.objects;
drop policy if exists "garment_assets_anon_insert_deny" on storage.objects;
drop policy if exists "garment_assets_anon_update_deny" on storage.objects;
drop policy if exists "garment_assets_anon_delete_deny" on storage.objects;
drop policy if exists "garment_assets_authenticated_select_deny" on storage.objects;
drop policy if exists "garment_assets_authenticated_insert_deny" on storage.objects;
drop policy if exists "garment_assets_authenticated_update_deny" on storage.objects;
drop policy if exists "garment_assets_authenticated_delete_deny" on storage.objects;

create policy "garment_assets_anon_select_deny"
  on storage.objects
  for select
  to anon
  using (bucket_id = 'garment-assets' and false);

create policy "garment_assets_anon_insert_deny"
  on storage.objects
  for insert
  to anon
  with check (bucket_id = 'garment-assets' and false);

create policy "garment_assets_anon_update_deny"
  on storage.objects
  for update
  to anon
  using (bucket_id = 'garment-assets' and false);

create policy "garment_assets_anon_delete_deny"
  on storage.objects
  for delete
  to anon
  using (bucket_id = 'garment-assets' and false);

create policy "garment_assets_authenticated_select_deny"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'garment-assets' and false);

create policy "garment_assets_authenticated_insert_deny"
  on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'garment-assets' and false);

create policy "garment_assets_authenticated_update_deny"
  on storage.objects
  for update
  to authenticated
  using (bucket_id = 'garment-assets' and false);

create policy "garment_assets_authenticated_delete_deny"
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'garment-assets' and false);
