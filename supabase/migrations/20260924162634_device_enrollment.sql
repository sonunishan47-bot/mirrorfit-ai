-- MirrorFit AI - device enrollment
--
-- How a mirror gets an identity.
--
-- A technician installs a mini PC in a store. It must end up holding a
-- long-lived device secret without that secret ever being typed by a human,
-- emailed, or baked into a disk image. So enrollment is a two-step exchange:
-- a manager pre-creates the display and issues a short-lived, single-use,
-- human-typable code, and the mirror trades that code for a secret exactly
-- once.
--
-- Why a code and a secret rather than one credential:
--   - The code is typed by a person, so it must be short, which caps its
--     entropy. Short life and single use are what make that safe.
--   - The secret is stored by a machine, so it can be full strength and
--     long-lived, and it never passes through a human.
--
-- Everything below that mutates state is a function rather than a sequence of
-- statements from the application. PostgREST gives the server no transaction
-- to wrap multiple calls in, and enrollment writes four tables. Doing it in
-- one function means a mirror can never end up with a credential but no
-- installation record, or a claimed code and no credential.

-- ---------------------------------------------------------------------------
-- device_enrollment_codes
-- ---------------------------------------------------------------------------
create table public.device_enrollment_codes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  shop_id uuid not null,
  display_id uuid not null,

  -- Only the hash. A leaked backup must not let someone enroll a mirror.
  code_hash text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),

  expires_at timestamptz not null,
  claimed_at timestamptz,
  claimed_credential_id uuid references public.device_credentials (id) on delete set null,
  revoked_at timestamptz,

  created_by uuid not null,
  created_at timestamptz not null default now(),

  foreign key (display_id, organization_id)
    references public.displays (id, organization_id) on delete cascade,
  foreign key (display_id, shop_id)
    references public.displays (id, shop_id) on delete cascade,
  foreign key (created_by, organization_id)
    references public.staff_users (id, organization_id) on delete cascade,

  constraint device_enrollment_codes_expiry_after_issue
    check (expires_at > created_at),

  -- A claimed code names the credential it produced. Without this pairing an
  -- audit could show a code as used with no way to say what it minted.
  constraint device_enrollment_codes_claim_consistency
    check ((claimed_at is null) = (claimed_credential_id is null))
);

comment on table public.device_enrollment_codes is
  'Short-lived single-use codes exchanged by a mirror for a device secret.';
comment on column public.device_enrollment_codes.code_hash is
  'sha-256 of the normalised code. The code itself is shown to staff once.';

-- At most one outstanding code per mirror, so a technician can never be
-- holding two that both work. Issuing a new one revokes the previous one.
create unique index device_enrollment_codes_outstanding_idx
  on public.device_enrollment_codes (display_id)
  where claimed_at is null and revoked_at is null;

create index device_enrollment_codes_organization_id_idx
  on public.device_enrollment_codes (organization_id);
create index device_enrollment_codes_display_org_idx
  on public.device_enrollment_codes (display_id, organization_id);
create index device_enrollment_codes_display_shop_idx
  on public.device_enrollment_codes (display_id, shop_id);
create index device_enrollment_codes_shop_org_idx
  on public.device_enrollment_codes (shop_id, organization_id);
create index device_enrollment_codes_created_by_org_idx
  on public.device_enrollment_codes (created_by, organization_id);
create index device_enrollment_codes_claimed_credential_id_idx
  on public.device_enrollment_codes (claimed_credential_id);

-- ---------------------------------------------------------------------------
-- Row level security
--
-- Staff may see that a code exists and whether it is still outstanding.
-- Issuing and claiming are server operations, so there is no write policy.
-- ---------------------------------------------------------------------------
alter table public.device_enrollment_codes enable row level security;
alter table public.device_enrollment_codes force row level security;

create policy device_enrollment_codes_select on public.device_enrollment_codes
  for select to authenticated
  using (
    organization_id = (select app.current_org_id())
    and (select app.can_access_shop(shop_id))
    and (select app.current_role_rank()) >= 3
  );

-- Column grants, not a column revoke. Revoking a column from under a
-- table-wide grant does nothing; see the privilege hardening migration.
revoke all on public.device_enrollment_codes from authenticated;
grant select (
  id,
  organization_id,
  shop_id,
  display_id,
  expires_at,
  claimed_at,
  claimed_credential_id,
  revoked_at,
  created_by,
  created_at
) on public.device_enrollment_codes to authenticated;

revoke all on public.device_enrollment_codes from anon;

-- ---------------------------------------------------------------------------
-- issue_device_enrollment_code
--
-- Lives in `public` because PostgREST only exposes that schema, so this is
-- the only place an RPC-callable function can go. Execute is granted to
-- `service_role` alone, which means only server code holding the secret key
-- can reach it.
-- ---------------------------------------------------------------------------
-- Returns jsonb rather than a table. With `returns table` the output names
-- become plpgsql variables, and names like `display_id` then collide with the
-- real columns in an ON CONFLICT target or an INSERT list. jsonb sidesteps
-- that entirely, and the route parses the result with Zod either way.
create function public.issue_device_enrollment_code(
  p_display_id uuid,
  p_staff_id uuid,
  p_code_hash text,
  p_ttl_seconds int
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_shop uuid;
  v_id uuid;
  v_expires timestamptz;
begin
  if p_ttl_seconds is null or p_ttl_seconds < 60 or p_ttl_seconds > 86400 then
    raise exception 'ttl out of range' using errcode = '22023';
  end if;

  select d.organization_id, d.shop_id
  into v_org, v_shop
  from public.displays d
  where d.id = p_display_id;

  if v_org is null then
    raise exception 'display not found' using errcode = 'P0002';
  end if;

  -- The route has already authorized the caller. This checks it again from
  -- the data rather than trusting the argument, so a bug in one route cannot
  -- mint a code for another tenant's mirror.
  perform 1
  from public.staff_users su
  where su.id = p_staff_id
    and su.organization_id = v_org
    and app.role_rank(su.role) >= 3;

  if not found then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  update public.device_enrollment_codes
  set revoked_at = now()
  where display_id = p_display_id
    and claimed_at is null
    and revoked_at is null;

  insert into public.device_enrollment_codes
    (organization_id, shop_id, display_id, code_hash, expires_at, created_by)
  values
    (v_org, v_shop, p_display_id, p_code_hash,
     now() + make_interval(secs => p_ttl_seconds), p_staff_id)
  returning id, expires_at into v_id, v_expires;

  return jsonb_build_object('code_id', v_id, 'expires_at', v_expires);
end;
$$;

-- ---------------------------------------------------------------------------
-- claim_device_enrollment_code
--
-- The mirror's side of the exchange. One transaction covering four tables.
--
-- The credential is inserted before the code is claimed, because the claim
-- has to record which credential it produced and the check constraint above
-- refuses a half-filled pair. The claim is a single conditional UPDATE, which
-- is what makes the code genuinely single-use: two mirrors racing the same
-- code both insert a credential, exactly one wins the UPDATE, and the loser's
-- insert disappears with its transaction.
-- ---------------------------------------------------------------------------
create function public.claim_device_enrollment_code(
  p_code_hash text,
  p_secret_hash text,
  p_app_version text,
  p_screen_width int,
  p_screen_height int,
  p_hardware_info jsonb
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
  set app_version = coalesce(p_app_version, d.app_version),
      screen_width = coalesce(p_screen_width, d.screen_width),
      screen_height = coalesce(p_screen_height, d.screen_height),
      hardware_info = coalesce(p_hardware_info, d.hardware_info),
      status = 'ONLINE',
      last_heartbeat_at = now()
  where d.id = v_code.display_id
  returning d.name, d.slug into v_name, v_slug;

  -- The commercial record of a deployed mirror. Re-enrolling a replaced mini
  -- PC updates the existing installation rather than creating a second one.
  insert into public.installations
    (organization_id, shop_id, display_id, status, installed_on, software_version)
  values
    (v_code.organization_id, v_code.shop_id, v_code.display_id,
     'ACTIVE', current_date, p_app_version)
  on conflict (display_id) do update
    set status = 'ACTIVE',
        software_version = coalesce(excluded.software_version, public.installations.software_version);

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
-- Appends a sample and rolls the denormalised fields on `displays` forward in
-- the same transaction, so the dashboard's "last seen" can never disagree
-- with the newest sample.
--
-- Every metric is nullable and is written through as-is. A mirror that did
-- not measure its frame rate sends null and null is stored; substituting zero
-- here would turn "not measured" into "stalled".
-- ---------------------------------------------------------------------------
create function public.record_device_heartbeat(
  p_display_id uuid,
  p_app_version text,
  p_camera_ok boolean,
  p_render_fps numeric,
  p_processing_fps numeric,
  p_metrics jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_shop uuid;
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
    (v_org, v_shop, p_display_id, p_app_version, p_camera_ok,
     p_render_fps, p_processing_fps, coalesce(p_metrics, '{}'::jsonb));

  update public.displays d
  set last_heartbeat_at = now(),
      status = case when d.status = 'MAINTENANCE' then d.status else 'ONLINE' end,
      camera_ok = coalesce(p_camera_ok, d.camera_ok),
      app_version = coalesce(p_app_version, d.app_version)
  where d.id = p_display_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges
--
-- These run as their definer and bypass RLS by design, so they must not be
-- reachable from a browser session. Only the server's secret key may call
-- them.
-- ---------------------------------------------------------------------------
revoke execute on function
  public.issue_device_enrollment_code(uuid, uuid, text, int),
  public.claim_device_enrollment_code(text, text, text, int, int, jsonb),
  public.record_device_heartbeat(uuid, text, boolean, numeric, numeric, jsonb)
from public, anon, authenticated;

grant execute on function
  public.issue_device_enrollment_code(uuid, uuid, text, int),
  public.claim_device_enrollment_code(text, text, text, int, int, jsonb),
  public.record_device_heartbeat(uuid, text, boolean, numeric, numeric, jsonb)
to service_role;
