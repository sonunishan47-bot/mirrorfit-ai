-- MirrorFit AI - revoke prior device credentials on re-enrollment
--
-- Problem
-- -------
-- claim_device_enrollment_code inserted a new hashed credential without
-- revoking earlier active credentials for the same display. A replaced or
-- decommissioned mirror could keep authenticating with the old secret.
--
-- Fix
-- ---
-- Inside the same security-definer transaction that claims the enrollment
-- code:
--   1. Lock the display row (serializes concurrent enroll for that mirror).
--   2. Revoke every currently active credential for that display.
--   3. Insert the new credential (hash only).
--   4. Conditionally claim the code (single-use gate).
--
-- If the claim gate fails, the whole transaction rolls back — including the
-- revoke — so a failed enrollment cannot lock out a still-working device.
-- Outside observers never see a window with two active credentials, and
-- after commit the old secret is rejected by authenticateDevice (revoked_at).
--
-- Also enforces one active credential per display at the index layer so the
-- invariant holds even if a future code path forgets to revoke first.

-- Collapse any historical duplicates before the unique index is applied.
-- Keep the newest active row per display; revoke the rest.
with ranked as (
  select
    c.id,
    row_number() over (
      partition by c.display_id
      order by c.issued_at desc, c.created_at desc, c.id desc
    ) as rn
  from public.device_credentials c
  where c.revoked_at is null
)
update public.device_credentials c
set revoked_at = now()
from ranked r
where c.id = r.id
  and r.rn > 1;

-- Replace the non-unique active lookup index with a uniqueness-enforcing one.
-- The unique partial index still supports "active credentials for display" lookups.
drop index if exists public.device_credentials_active_idx;

create unique index device_credentials_one_active_per_display_idx
  on public.device_credentials (display_id)
  where revoked_at is null;

comment on index public.device_credentials_one_active_per_display_idx is
  'At most one non-revoked device credential per display. Re-enrollment must revoke first.';

create or replace function public.claim_device_enrollment_code(
  p_code_hash text,
  p_secret_hash text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code public.device_enrollment_codes%rowtype;
  v_display_id uuid;
  v_credential_id uuid;
  v_claimed uuid;
  v_name text;
  v_slug text;
  v_app_version text := nullif(p_payload ->> 'app_version', '');
  v_screen_width int := (p_payload ->> 'screen_width')::int;
  v_screen_height int := (p_payload ->> 'screen_height')::int;
  v_hardware jsonb := case
    when jsonb_typeof(p_payload -> 'hardware_info') = 'object'
      then p_payload -> 'hardware_info'
    else null
  end;
begin
  select *
  into v_code
  from public.device_enrollment_codes c
  where c.code_hash = p_code_hash;

  -- One error for every rejection reason. Telling a caller that a code is
  -- real but expired confirms the code is real.
  if v_code.id is null
     or v_code.claimed_at is not null
     or v_code.revoked_at is not null
     or v_code.expires_at <= now()
  then
    raise exception 'invalid enrollment code' using errcode = 'P0002';
  end if;

  -- Serialize enrollment for this display. Concurrent claims for the same
  -- mirror cannot interleave revoke/insert across transactions.
  select d.id
  into v_display_id
  from public.displays d
  where d.id = v_code.display_id
  for update;

  if v_display_id is null then
    raise exception 'invalid enrollment code' using errcode = 'P0002';
  end if;

  -- Revoke every active credential for this display (and org) before minting
  -- the replacement. Same transaction as the insert and code claim below:
  -- failure after this point rolls the revoke back.
  update public.device_credentials c
  set revoked_at = now()
  where c.display_id = v_code.display_id
    and c.organization_id = v_code.organization_id
    and c.revoked_at is null;

  insert into public.device_credentials
    (organization_id, shop_id, display_id, secret_hash, label)
  values
    (v_code.organization_id, v_code.shop_id, v_code.display_id, p_secret_hash, 'Enrolled device')
  returning id into v_credential_id;

  update public.device_enrollment_codes c
  set claimed_at = now(),
      claimed_credential_id = v_credential_id
  where c.id = v_code.id
    and c.claimed_at is null
    and c.revoked_at is null
    and c.expires_at > now()
  returning c.id into v_claimed;

  if v_claimed is null then
    raise exception 'invalid enrollment code' using errcode = 'P0002';
  end if;

  update public.displays d
  set app_version = coalesce(v_app_version, d.app_version),
      screen_width = coalesce(v_screen_width, d.screen_width),
      screen_height = coalesce(v_screen_height, d.screen_height),
      hardware_info = coalesce(v_hardware, d.hardware_info),
      status = 'ONLINE',
      last_heartbeat_at = now()
  where d.id = v_code.display_id
  returning d.name, d.slug into v_name, v_slug;

  insert into public.installations
    (organization_id, shop_id, display_id, status, installed_on, software_version)
  values
    (v_code.organization_id, v_code.shop_id, v_code.display_id,
     'ACTIVE', current_date, v_app_version)
  on conflict (display_id) do update
    set status = 'ACTIVE',
        software_version =
          coalesce(excluded.software_version, public.installations.software_version);

  return jsonb_build_object(
    'display_id', v_code.display_id,
    'organization_id', v_code.organization_id,
    'shop_id', v_code.shop_id,
    'credential_id', v_credential_id,
    'display_name', v_name,
    'display_slug', v_slug
  );
end;
$$;

revoke execute on function
  public.claim_device_enrollment_code(text, text, jsonb)
from public, anon, authenticated;

grant execute on function
  public.claim_device_enrollment_code(text, text, jsonb)
to service_role;
