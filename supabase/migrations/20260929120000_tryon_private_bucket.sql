-- MirrorFit AI - private tryon-private Storage bucket
--
-- Customer stills for the optional photorealistic job. Not garment-assets:
-- a catalog overlay and a body photo must not share a bucket.
--
-- * Private bucket. anon and authenticated are explicitly denied.
-- * service_role (the device and worker routes, after auth) is the only
--   writer and the only signer of short-lived URLs.
-- * JPEG only. 2 MiB matches the application still cap.
-- * Object keys are tenant-scoped:
--     {organization_id}/{shop_id}/tryon/{session_id}/{job_id}.jpg
--     {organization_id}/{shop_id}/tryon/{session_id}/{job_id}-out.jpg

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'tryon-private',
  'tryon-private',
  false,
  2097152,
  array['image/jpeg']::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types,
  updated_at = now();

drop policy if exists "tryon_private_anon_select_deny" on storage.objects;
drop policy if exists "tryon_private_anon_insert_deny" on storage.objects;
drop policy if exists "tryon_private_anon_update_deny" on storage.objects;
drop policy if exists "tryon_private_anon_delete_deny" on storage.objects;
drop policy if exists "tryon_private_authenticated_select_deny" on storage.objects;
drop policy if exists "tryon_private_authenticated_insert_deny" on storage.objects;
drop policy if exists "tryon_private_authenticated_update_deny" on storage.objects;
drop policy if exists "tryon_private_authenticated_delete_deny" on storage.objects;

create policy "tryon_private_anon_select_deny"
  on storage.objects
  for select
  to anon
  using (bucket_id = 'tryon-private' and false);

create policy "tryon_private_anon_insert_deny"
  on storage.objects
  for insert
  to anon
  with check (bucket_id = 'tryon-private' and false);

create policy "tryon_private_anon_update_deny"
  on storage.objects
  for update
  to anon
  using (bucket_id = 'tryon-private' and false);

create policy "tryon_private_anon_delete_deny"
  on storage.objects
  for delete
  to anon
  using (bucket_id = 'tryon-private' and false);

create policy "tryon_private_authenticated_select_deny"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'tryon-private' and false);

create policy "tryon_private_authenticated_insert_deny"
  on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'tryon-private' and false);

create policy "tryon_private_authenticated_update_deny"
  on storage.objects
  for update
  to authenticated
  using (bucket_id = 'tryon-private' and false);

create policy "tryon_private_authenticated_delete_deny"
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'tryon-private' and false);
