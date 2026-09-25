-- MirrorFit AI - session lifecycle and tenant provisioning
--
-- Phase 2 created the `sessions` table and its constraints. Nothing has ever
-- written to it. This migration adds the behaviour: how a session begins,
-- how a phone claims it exactly once, how it ends, and how abandoned ones
-- are swept up.
--
-- No new session table is created. The Phase 2 schema already models
-- everything needed, including the nullable `pairing_claimed_at` that the
-- single-use claim competes over.
--
-- Where the logic lives
-- ---------------------
-- In plpgsql, for the same reason device enrollment is: each of these
-- operations spans several statements that must succeed or fail together,
-- and PostgREST gives the server no multi-statement transaction. A mirror
-- that ended the previous session but failed to open the next one would be
-- a bricked kiosk.
--
-- These are `security definer` and granted only to `service_role`. Neither a
-- mirror nor a customer phone is a database user; both reach this through a
-- trusted server route that resolves tenancy from a device credential.
--
-- Returning jsonb rather than a table, again because plpgsql output
-- parameter names collide with the real column names they are selected from.

-- ---------------------------------------------------------------------------
-- Session isolation
--
-- One mirror shows one session at a time. Enforcing that with a partial
-- unique index makes a second live session on the same display impossible at
-- the storage layer, rather than a rule every caller has to remember.
--
-- It also forces the reset to be explicit: `create_display_session` cannot
-- open a new session without first closing the old one, because the index
-- would reject the insert.
-- ---------------------------------------------------------------------------
create unique index sessions_one_live_per_display_idx
  on public.sessions (display_id)
  where status in ('WAITING', 'PAIRED', 'ACTIVE');

comment on index public.sessions_one_live_per_display_idx is
  'At most one non-terminal session per display. Session isolation, enforced structurally.';

-- Sweeping idle ACTIVE sessions reads last_activity_at, which the pairing
-- expiry index does not cover.
create index sessions_active_idle_idx on public.sessions (last_activity_at)
  where status = 'ACTIVE';

-- ---------------------------------------------------------------------------
-- create_display_session
--
-- Called by the mirror. The display id comes from the device credential the
-- route authenticated, never from a request body, and organization and shop
-- are resolved here from the display rather than trusted from the caller.
--
-- Any session still live on this display is terminated first. That is the
-- "reset the mirror" requirement: a customer who walks away without ending
-- their session cannot leave state visible to the next person, because the
-- next session cannot be created until the previous one is closed.
-- ---------------------------------------------------------------------------
create function public.create_display_session(
  p_display_id uuid,
  p_token_hash text,
  p_ttl_seconds int,
  p_locale text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_shop uuid;
  v_status public.device_status;
  v_locale text;
  v_session public.sessions%rowtype;
  v_superseded uuid;
begin
  if p_ttl_seconds is null or p_ttl_seconds < 30 or p_ttl_seconds > 3600 then
    raise exception 'pairing ttl out of range' using errcode = '22023';
  end if;

  select d.organization_id, d.shop_id, d.status, s.default_locale
  into v_org, v_shop, v_status, v_locale
  from public.displays d
  join public.shops s on s.id = d.shop_id
  where d.id = p_display_id;

  if v_org is null then
    raise exception 'display not found' using errcode = 'P0002';
  end if;

  -- A revoked mirror must not be able to start serving customers again on a
  -- credential that was issued before it was decommissioned.
  if v_status = 'REVOKED' then
    raise exception 'display is revoked' using errcode = '42501';
  end if;

  -- Close whatever was live. DISCONNECTED rather than CUSTOMER_ENDED: nobody
  -- told us the previous customer finished, we are reclaiming the mirror.
  update public.sessions s
  set status = 'ENDED',
      ended_at = now(),
      end_reason = 'DISCONNECTED',
      last_activity_at = now()
  where s.display_id = p_display_id
    and s.status in ('WAITING', 'PAIRED', 'ACTIVE')
  returning s.id into v_superseded;

  insert into public.sessions
    (organization_id, shop_id, display_id, status, pairing_token_hash,
     pairing_expires_at, locale)
  values
    (v_org, v_shop, p_display_id, 'WAITING', p_token_hash,
     now() + make_interval(secs => p_ttl_seconds),
     coalesce(nullif(p_locale, ''), v_locale, 'en'))
  returning * into v_session;

  return jsonb_build_object(
    'session_id', v_session.id,
    'organization_id', v_org,
    'shop_id', v_shop,
    'display_id', p_display_id,
    'status', v_session.status,
    'locale', v_session.locale,
    'pairing_expires_at', v_session.pairing_expires_at,
    'superseded_session_id', v_superseded
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- claim_session_pairing_token
--
-- Called by the customer's phone after scanning the QR code. This is the one
-- unauthenticated entry point in the session flow, so the token itself is the
-- entire credential: random, hashed at rest, short-lived, single-use.
--
-- The gate is a single conditional UPDATE. Two phones racing on the same QR
-- code both run this statement; Postgres serialises them on the row, the
-- second sees `pairing_claimed_at` already set, matches no rows, and loses.
-- There is no read-then-write window for them to interleave in.
-- ---------------------------------------------------------------------------
create function public.claim_session_pairing_token(
  p_token_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.sessions%rowtype;
begin
  update public.sessions s
  set status = 'PAIRED',
      pairing_claimed_at = now(),
      started_at = now(),
      last_activity_at = now()
  where s.pairing_token_hash = p_token_hash
    and s.status = 'WAITING'
    and s.pairing_claimed_at is null
    and s.pairing_revoked_at is null
    and s.pairing_expires_at > now()
  returning * into v_session;

  -- One error for every rejection reason: unknown token, already claimed,
  -- revoked, expired, wrong state. Distinguishing them would tell someone
  -- probing tokens that a given one was real.
  if v_session.id is null then
    raise exception 'invalid pairing token' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'session_id', v_session.id,
    'organization_id', v_session.organization_id,
    'shop_id', v_session.shop_id,
    'display_id', v_session.display_id,
    'status', v_session.status,
    'locale', v_session.locale
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- activate_display_session
--
-- PAIRED means the phone has the session; ACTIVE means the mirror has
-- acknowledged it and the two are talking. Keeping them distinct is what
-- lets the mirror show "connecting" rather than a half-live fitting screen.
--
-- The display id is passed separately and checked, so a mirror cannot
-- activate a session belonging to a different display.
-- ---------------------------------------------------------------------------
create function public.activate_display_session(
  p_session_id uuid,
  p_display_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.sessions%rowtype;
begin
  update public.sessions s
  set status = 'ACTIVE',
      last_activity_at = now()
  where s.id = p_session_id
    and s.display_id = p_display_id
    and s.status = 'PAIRED'
    and s.pairing_claimed_at is not null
  returning * into v_session;

  if v_session.id is null then
    raise exception 'session not pairable' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'session_id', v_session.id,
    'status', v_session.status
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- end_display_session
--
-- Terminal and one-way. A session that has already ended cannot be reopened,
-- and a second call does not overwrite the original reason or timestamp:
-- the first answer about why a session ended is the true one.
-- ---------------------------------------------------------------------------
create function public.end_display_session(
  p_session_id uuid,
  p_reason public.session_end_reason
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.sessions%rowtype;
begin
  update public.sessions s
  set status = 'ENDED',
      ended_at = now(),
      end_reason = p_reason,
      last_activity_at = now()
  where s.id = p_session_id
    and s.status in ('WAITING', 'PAIRED', 'ACTIVE')
  returning * into v_session;

  if v_session.id is null then
    select * into v_session from public.sessions s where s.id = p_session_id;

    if v_session.id is null then
      raise exception 'session not found' using errcode = 'P0002';
    end if;

    -- Already terminal. Report the existing outcome rather than failing, so
    -- a mirror retrying after a dropped response does not error.
    return jsonb_build_object(
      'session_id', v_session.id,
      'status', v_session.status,
      'end_reason', v_session.end_reason,
      'already_ended', true
    );
  end if;

  return jsonb_build_object(
    'session_id', v_session.id,
    'status', v_session.status,
    'end_reason', v_session.end_reason,
    'already_ended', false
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- expire_stale_sessions
--
-- Two different kinds of abandonment:
--
--   a QR code nobody scanned          -> past pairing_expires_at
--   a customer who walked away        -> ACTIVE but silent for too long
--
-- Both become EXPIRED with reason TIMEOUT. Intended to be driven by a
-- scheduled job; pg_cron wiring is deliberately left out until Phase 14,
-- where device monitoring decides the cadence.
-- ---------------------------------------------------------------------------
create function public.expire_stale_sessions(
  p_idle_seconds int default 900
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  with expired as (
    update public.sessions s
    set status = 'EXPIRED',
        ended_at = now(),
        end_reason = 'TIMEOUT'
    where (
        (s.status in ('WAITING', 'PAIRED') and s.pairing_expires_at <= now())
        or (
          s.status = 'ACTIVE'
          and s.last_activity_at <= now() - make_interval(secs => p_idle_seconds)
        )
      )
    returning s.id
  )
  select count(*) into v_count from expired;

  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- record_session_event
--
-- Append-only protocol log. `message_id` carries the protocol's own
-- idempotency key, so a message redelivered after a reconnect is recorded
-- once. `on conflict do nothing` is what makes the retry safe.
--
-- Events are only accepted for a live session. A closed session cannot
-- accumulate further history, which is what makes "the session is over"
-- mean something.
-- ---------------------------------------------------------------------------
create function public.record_session_event(
  p_session_id uuid,
  p_message_id uuid,
  p_type text,
  p_actor_kind public.actor_kind,
  p_protocol_version int,
  p_payload jsonb default '{}'::jsonb,
  p_occurred_at timestamptz default now()
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_shop uuid;
  v_inserted uuid;
begin
  select s.organization_id, s.shop_id
  into v_org, v_shop
  from public.sessions s
  where s.id = p_session_id
    and s.status in ('WAITING', 'PAIRED', 'ACTIVE');

  if v_org is null then
    raise exception 'session not active' using errcode = 'P0002';
  end if;

  insert into public.session_events
    (organization_id, shop_id, session_id, message_id, type, actor_kind,
     protocol_version, payload, occurred_at)
  values
    (v_org, v_shop, p_session_id, p_message_id, p_type, p_actor_kind,
     p_protocol_version,
     case when jsonb_typeof(p_payload) = 'object' then p_payload else '{}'::jsonb end,
     p_occurred_at)
  on conflict (session_id, message_id) do nothing
  returning id into v_inserted;

  update public.sessions s
  set last_activity_at = greatest(s.last_activity_at, p_occurred_at)
  where s.id = p_session_id;

  -- false means "already recorded", not "failed".
  return v_inserted is not null;
end;
$$;

-- ---------------------------------------------------------------------------
-- provision_organization
--
-- The bootstrap gap: `organizations` has no INSERT policy and
-- `staff_users_insert` requires an existing admin, so the first tenant of a
-- deployment cannot be created from inside the application by anyone. That
-- is the correct security posture, but it leaves no way in.
--
-- This is the way in, and it is deliberately not reachable over HTTP. It
-- runs as service_role from an operator script, and expects the Supabase Auth
-- user to already exist so that no password is ever handled here.
-- ---------------------------------------------------------------------------
create function public.provision_organization(
  p_org_name text,
  p_org_slug text,
  p_shop_name text,
  p_shop_slug text,
  p_owner_auth_user_id uuid,
  p_owner_email text,
  p_owner_name text default null,
  p_timezone text default 'UTC'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_shop_id uuid;
  v_staff_id uuid;
begin
  if not exists (select 1 from auth.users u where u.id = p_owner_auth_user_id) then
    raise exception 'auth user does not exist' using errcode = 'P0002';
  end if;

  insert into public.organizations (name, slug)
  values (p_org_name, p_org_slug)
  returning id into v_org_id;

  insert into public.shops (organization_id, name, slug, timezone)
  values (v_org_id, p_shop_name, p_shop_slug, p_timezone)
  returning id into v_shop_id;

  -- ORG_OWNER is organization-wide, so shop_id stays null. The
  -- staff_scope_matches_role constraint would reject anything else.
  insert into public.staff_users
    (organization_id, auth_user_id, shop_id, role, full_name, email)
  values
    (v_org_id, p_owner_auth_user_id, null, 'ORG_OWNER', p_owner_name, p_owner_email)
  returning id into v_staff_id;

  return jsonb_build_object(
    'organization_id', v_org_id,
    'shop_id', v_shop_id,
    'staff_user_id', v_staff_id
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Execution privileges
--
-- Same posture as the device functions: nobody holding a browser token can
-- call any of these. `public` is revoked explicitly because a new function
-- is granted to it by default.
-- ---------------------------------------------------------------------------
revoke execute on function
  public.create_display_session(uuid, text, int, text),
  public.claim_session_pairing_token(text),
  public.activate_display_session(uuid, uuid),
  public.end_display_session(uuid, public.session_end_reason),
  public.expire_stale_sessions(int),
  public.record_session_event(uuid, uuid, text, public.actor_kind, int, jsonb, timestamptz),
  public.provision_organization(text, text, text, text, uuid, text, text, text)
from public, anon, authenticated;

grant execute on function
  public.create_display_session(uuid, text, int, text),
  public.claim_session_pairing_token(text),
  public.activate_display_session(uuid, uuid),
  public.end_display_session(uuid, public.session_end_reason),
  public.expire_stale_sessions(int),
  public.record_session_event(uuid, uuid, text, public.actor_kind, int, jsonb, timestamptz),
  public.provision_organization(text, text, text, text, uuid, text, text, text)
to service_role;
