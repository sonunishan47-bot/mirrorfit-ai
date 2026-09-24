-- MirrorFit AI - device RPC payload shape
--
-- Replaces the two device functions with ones that take a jsonb payload
-- instead of a column of scalar parameters.
--
-- Why
-- ---
-- A Postgres function parameter is nullable, but nothing in the catalog says
-- so, and the Supabase type generator therefore emits every argument as
-- non-null and required. That makes the honest call impossible to write:
--
--   p_render_fps: null   // Type 'null' is not assignable to type 'number'
--
-- A mirror that did not measure its frame rate must report null, because
-- zero would mean a stalled pipeline. The choice was between casting away
-- the generated type at the one boundary where the rule says to parse rather
-- than cast, or changing the signature. This changes the signature.
--
-- The payload is validated by Zod before it is sent, and each field is read
-- back out here with an explicit cast, so the looseness is confined to the
-- wire format rather than spreading into the tables.
--
-- It also means a new metric is a new key, not a new function signature and
-- a fourth migration touching these definitions.

drop function public.claim_device_enrollment_code(text, text, text, int, int, jsonb);
drop function public.record_device_heartbeat(uuid, text, boolean, numeric, numeric, jsonb);

-- ---------------------------------------------------------------------------
-- claim_device_enrollment_code
--
-- Behaviour is unchanged from the previous definition: one transaction that
-- claims the code, mints the credential, brings the display online and opens
-- the installation record, with a single conditional UPDATE as the gate that
-- makes the code genuinely single-use.
-- ---------------------------------------------------------------------------
create function public.claim_device_enrollment_code(
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
  v_credential_id uuid;
  v_claimed uuid;
  v_name text;
  v_slug text;
  v_app_version text := nullif(p_payload ->> 'app_version', '');
  v_screen_width int := (p_payload ->> 'screen_width')::int;
  v_screen_height int := (p_payload ->> 'screen_height')::int;
  -- `->` yields a jsonb null for an explicit null, which coalesce would not
  -- catch, so the type is checked rather than the value.
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

-- ---------------------------------------------------------------------------
-- record_device_heartbeat
--
-- A missing key and an explicit null both arrive here as SQL NULL and are
-- stored as NULL. That is the whole point: the column has to distinguish a
-- mirror that did not measure something from one that measured zero.
-- ---------------------------------------------------------------------------
create function public.record_device_heartbeat(
  p_display_id uuid,
  p_payload jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_shop uuid;
  v_app_version text := nullif(p_payload ->> 'app_version', '');
  v_camera_ok boolean := (p_payload ->> 'camera_ok')::boolean;
  v_render_fps numeric := (p_payload ->> 'render_fps')::numeric;
  v_processing_fps numeric := (p_payload ->> 'processing_fps')::numeric;
  v_metrics jsonb := case
    when jsonb_typeof(p_payload -> 'metrics') = 'object' then p_payload -> 'metrics'
    else '{}'::jsonb
  end;
begin
  select d.organization_id, d.shop_id
  into v_org, v_shop
  from public.displays d
  where d.id = p_display_id;

  if v_org is null then
    raise exception 'display not found' using errcode = 'P0002';
  end if;

  insert into public.device_heartbeats
    (organization_id, shop_id, display_id, app_version, camera_ok,
     render_fps, processing_fps, metrics)
  values
    (v_org, v_shop, p_display_id, v_app_version, v_camera_ok,
     v_render_fps, v_processing_fps, v_metrics);

  update public.displays d
  set last_heartbeat_at = now(),
      -- A mirror under maintenance stays under maintenance. Its heartbeat
      -- says it is running, not that someone finished working on it.
      status = case when d.status = 'MAINTENANCE' then d.status else 'ONLINE' end,
      camera_ok = coalesce(v_camera_ok, d.camera_ok),
      app_version = coalesce(v_app_version, d.app_version)
  where d.id = p_display_id;
end;
$$;

revoke execute on function
  public.claim_device_enrollment_code(text, text, jsonb),
  public.record_device_heartbeat(uuid, jsonb)
from public, anon, authenticated;

grant execute on function
  public.claim_device_enrollment_code(text, text, jsonb),
  public.record_device_heartbeat(uuid, jsonb)
to service_role;
