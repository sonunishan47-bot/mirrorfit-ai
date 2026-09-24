-- MirrorFit AI - devices and installations
--
-- A mirror has no database identity. It authenticates to trusted server
-- routes with a device credential, and those routes use the secret key. So
-- these tables carry staff-facing read policies and almost no write policies:
-- issuing a credential or recording a heartbeat is server work, not something
-- a logged-in browser session should be able to do.

-- ---------------------------------------------------------------------------
-- displays
-- ---------------------------------------------------------------------------
create table public.displays (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  shop_id uuid not null,
  name text not null check (length(btrim(name)) between 1 and 200),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 64),
  status public.device_status not null default 'OFFLINE',

  screen_width int check (screen_width > 0 and screen_width <= 16384),
  screen_height int check (screen_height > 0 and screen_height <= 16384),
  app_version text check (app_version ~ '^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$'),
  hardware_info jsonb not null default '{}'::jsonb,

  -- NULL means never reported, which is different from reported-as-broken.
  camera_ok boolean,
  last_heartbeat_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  foreign key (shop_id, organization_id)
    references public.shops (id, organization_id) on delete cascade,

  unique (shop_id, slug),

  -- Composite-unique targets so descendants can prove both their
  -- organization and their shop match this display's.
  unique (id, organization_id),
  unique (id, shop_id)
);

comment on table public.displays is
  'A physical smart mirror. Belongs to exactly one shop at a time.';
comment on column public.displays.camera_ok is
  'NULL = never reported. Distinguishes "unknown" from "camera failed".';

-- ---------------------------------------------------------------------------
-- device_credentials
--
-- The plaintext secret exists only twice: in the response that provisions the
-- mirror, and in the mirror's own local storage. This table holds a keyed
-- hash and nothing else, so a database disclosure does not let an attacker
-- impersonate a mirror.
-- ---------------------------------------------------------------------------
create table public.device_credentials (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  shop_id uuid not null,
  display_id uuid not null,

  label text check (length(btrim(label)) between 1 and 120),
  secret_hash text not null unique check (secret_hash ~ '^[0-9a-f]{64}$'),

  issued_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),

  foreign key (display_id, organization_id)
    references public.displays (id, organization_id) on delete cascade,
  foreign key (display_id, shop_id)
    references public.displays (id, shop_id) on delete cascade,

  constraint device_credentials_expiry_after_issue
    check (expires_at is null or expires_at > issued_at)
);

comment on table public.device_credentials is
  'Keyed hash of a mirror device secret. Plaintext is never stored.';

-- ---------------------------------------------------------------------------
-- device_heartbeats
--
-- Append-only time series. Metric columns are nullable and have no default:
-- a mirror that did not measure its frame rate must report NULL, because a
-- stored 0 would be indistinguishable from a genuinely stalled pipeline.
-- ---------------------------------------------------------------------------
create table public.device_heartbeats (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  shop_id uuid not null,
  display_id uuid not null,

  observed_at timestamptz not null default now(),
  app_version text check (app_version ~ '^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$'),
  camera_ok boolean,
  render_fps numeric(6, 2) check (render_fps >= 0),
  processing_fps numeric(6, 2) check (processing_fps >= 0),
  metrics jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),

  foreign key (display_id, organization_id)
    references public.displays (id, organization_id) on delete cascade,
  foreign key (display_id, shop_id)
    references public.displays (id, shop_id) on delete cascade
);

comment on table public.device_heartbeats is
  'Append-only device health samples. NULL metrics mean unmeasured, not zero.';

-- ---------------------------------------------------------------------------
-- installations
--
-- The commercial record of a deployed system. Deliberately not a billing
-- subscription: it tracks what is installed where, and its lifecycle status.
-- ---------------------------------------------------------------------------
create table public.installations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  shop_id uuid not null,
  display_id uuid not null unique,

  status public.installation_status not null default 'ACTIVE',
  installed_on date,
  software_version text check (software_version ~ '^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$'),
  notes text check (length(notes) <= 4000),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  foreign key (shop_id, organization_id)
    references public.shops (id, organization_id) on delete cascade,
  foreign key (display_id, organization_id)
    references public.displays (id, organization_id) on delete cascade,
  foreign key (display_id, shop_id)
    references public.displays (id, shop_id) on delete cascade
);

comment on table public.installations is
  'Lightweight license/deployment record for one installed mirror.';

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
create index displays_organization_id_idx on public.displays (organization_id);
create index displays_shop_id_idx on public.displays (shop_id);
create index displays_status_idx on public.displays (status);

create index device_credentials_organization_id_idx on public.device_credentials (organization_id);
create index device_credentials_shop_id_idx on public.device_credentials (shop_id);
create index device_credentials_display_id_idx on public.device_credentials (display_id);
-- Credential verification looks up live credentials only.
create index device_credentials_active_idx on public.device_credentials (display_id)
  where revoked_at is null;

create index device_heartbeats_organization_id_idx on public.device_heartbeats (organization_id);
create index device_heartbeats_shop_id_idx on public.device_heartbeats (shop_id);
-- "Latest heartbeat for this mirror" is the dashboard's hottest query.
create index device_heartbeats_display_observed_idx
  on public.device_heartbeats (display_id, observed_at desc);

create index installations_organization_id_idx on public.installations (organization_id);
create index installations_shop_id_idx on public.installations (shop_id);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
create trigger displays_set_updated_at
  before update on public.displays
  for each row execute function app.set_updated_at();

create trigger installations_set_updated_at
  before update on public.installations
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.displays enable row level security;
alter table public.displays force row level security;
alter table public.device_credentials enable row level security;
alter table public.device_credentials force row level security;
alter table public.device_heartbeats enable row level security;
alter table public.device_heartbeats force row level security;
alter table public.installations enable row level security;
alter table public.installations force row level security;

-- displays
create policy displays_select on public.displays
  for select to authenticated
  using (
    organization_id = (select app.current_org_id())
    and (select app.can_access_shop(shop_id))
  );

create policy displays_insert on public.displays
  for insert to authenticated
  with check (
    organization_id = (select app.current_org_id())
    and (select app.current_role_rank()) >= 3
  );

create policy displays_update on public.displays
  for update to authenticated
  using (
    organization_id = (select app.current_org_id())
    and (select app.current_role_rank()) >= 3
  )
  with check (organization_id = (select app.current_org_id()));

create policy displays_delete on public.displays
  for delete to authenticated
  using (
    organization_id = (select app.current_org_id())
    and (select app.current_role_rank()) >= 3
  );

-- device_credentials: admins may list and revoke, never read the hash and
-- never mint one. Issuing requires generating the secret, which only server
-- code holding the secret key does.
create policy device_credentials_select on public.device_credentials
  for select to authenticated
  using (
    organization_id = (select app.current_org_id())
    and (select app.current_role_rank()) >= 3
  );

create policy device_credentials_update on public.device_credentials
  for update to authenticated
  using (
    organization_id = (select app.current_org_id())
    and (select app.current_role_rank()) >= 3
  )
  with check (organization_id = (select app.current_org_id()));

-- RLS is row-level, so the hash is withheld with a column privilege instead.
-- Without this an admin could select it and replay it as a mirror.
--
-- WARNING: these two statements do nothing. A column-level revoke cannot
-- subtract from the table-wide grant Supabase issues to `authenticated`;
-- Postgres checks the table grant first and stops. Verified against
-- information_schema, which still reported the privilege afterwards. They are
-- left here because this migration has already been applied and migrations
-- are not rewritten. The working form — revoke the table grant, then grant
-- back only the safe columns — is in 20260924160338_privilege_hardening.sql.
revoke select (secret_hash) on public.device_credentials from authenticated;
revoke update (secret_hash) on public.device_credentials from authenticated;

-- device_heartbeats: read-only for staff. Ingestion is a server route.
create policy device_heartbeats_select on public.device_heartbeats
  for select to authenticated
  using (
    organization_id = (select app.current_org_id())
    and (select app.can_access_shop(shop_id))
  );

-- installations
create policy installations_select on public.installations
  for select to authenticated
  using (
    organization_id = (select app.current_org_id())
    and (select app.can_access_shop(shop_id))
  );

create policy installations_insert on public.installations
  for insert to authenticated
  with check (
    organization_id = (select app.current_org_id())
    and (select app.current_role_rank()) >= 3
  );

create policy installations_update on public.installations
  for update to authenticated
  using (
    organization_id = (select app.current_org_id())
    and (select app.current_role_rank()) >= 3
  )
  with check (organization_id = (select app.current_org_id()));

create policy installations_delete on public.installations
  for delete to authenticated
  using (
    organization_id = (select app.current_org_id())
    and (select app.current_role_rank()) >= 3
  );
