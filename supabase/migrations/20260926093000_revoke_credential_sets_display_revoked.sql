-- MirrorFit AI - set displays.status = REVOKED when a credential is revoked
--
-- Problem
-- -------
-- Staff revoke only set device_credentials.revoked_at. Ops fleet health keys
-- off displays.status = 'REVOKED', so a revoked mirror looked merely
-- stale/offline after heartbeats stopped.
--
-- Fix
-- ---
-- AFTER UPDATE trigger on device_credentials: when revoked_at transitions
-- from null → non-null, set the owning display to REVOKED in the same
-- transaction. Failed credential updates never fire the trigger.
--
-- Re-enrollment (claim_device_enrollment_code) revokes prior credentials then
-- sets the display ONLINE in the same transaction, so observers never see a
-- stuck REVOKED after a successful re-enroll.

create or replace function public.on_device_credential_revoked()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only the first revoke of a credential marks the display. Re-applying
  -- revoked_at must not thrash status; re-enrollment restores ONLINE itself.
  if NEW.revoked_at is not null and OLD.revoked_at is null then
    update public.displays d
    set status = 'REVOKED'::public.device_status
    where d.id = NEW.display_id
      and d.organization_id = NEW.organization_id
      and d.status is distinct from 'REVOKED'::public.device_status;
  end if;

  return NEW;
end;
$$;

revoke all on function public.on_device_credential_revoked() from public, anon, authenticated;

drop trigger if exists device_credentials_after_revoke on public.device_credentials;

create trigger device_credentials_after_revoke
  after update of revoked_at on public.device_credentials
  for each row
  when (NEW.revoked_at is not null and OLD.revoked_at is null)
  execute function public.on_device_credential_revoked();

comment on function public.on_device_credential_revoked() is
  'When a device credential is first revoked, mark its display REVOKED in the same transaction.';
