-- MirrorFit AI - recommendation telemetry, try-on jobs, audit trail
--
-- Privacy stance encoded here
-- ---------------------------
-- These tables record what was *suggested* and what was *chosen*. They do not
-- record estimated body measurements, and there is deliberately no column for
-- them: retaining a customer's body dimensions after their session ends is
-- not required to operate or tune the product, and no schema affordance for
-- it should exist to be filled in later by accident.
--
-- A photorealistic try-on job cannot exist without a consent row, because
-- `consent_id` is NOT NULL and foreign-keyed to a consent for the same
-- session. That turns "we ask for consent" from a code path into a database
-- invariant.

-- Lets tryon_jobs prove its consent belongs to the same session.
alter table public.consents
  add constraint consents_id_session_id_key unique (id, session_id);

-- ---------------------------------------------------------------------------
-- recommendation_events
-- ---------------------------------------------------------------------------
create table public.recommendation_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  shop_id uuid not null,
  session_id uuid not null,

  request_id uuid not null,
  category text check (length(btrim(category)) between 1 and 80),
  seed_variant_ids uuid[] not null default '{}',
  results jsonb not null default '[]'::jsonb,

  model_version text not null check (length(btrim(model_version)) between 1 and 60),
  latency_ms int check (latency_ms >= 0),

  created_at timestamptz not null default now(),

  foreign key (session_id, organization_id)
    references public.sessions (id, organization_id) on delete cascade,
  foreign key (session_id, shop_id)
    references public.sessions (id, shop_id) on delete cascade,

  unique (session_id, request_id)
);

comment on table public.recommendation_events is
  'What the recommender suggested, for tuning. Stores no body or identity data.';

-- ---------------------------------------------------------------------------
-- size_recommendation_events
-- ---------------------------------------------------------------------------
create table public.size_recommendation_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  shop_id uuid not null,
  session_id uuid not null,

  request_id uuid not null,
  garment_id uuid not null,
  variant_id uuid not null,

  recommended_size public.size_label not null,
  confidence numeric(4, 3) not null check (confidence >= 0 and confidence <= 1),
  alternatives public.size_label[] not null default '{}',
  rationale text check (length(rationale) <= 500),

  -- What the customer actually picked. The only honest way to tell whether
  -- the recommendation was any good.
  accepted_size public.size_label,

  model_version text not null check (length(btrim(model_version)) between 1 and 60),
  created_at timestamptz not null default now(),

  foreign key (session_id, organization_id)
    references public.sessions (id, organization_id) on delete cascade,
  foreign key (session_id, shop_id)
    references public.sessions (id, shop_id) on delete cascade,
  foreign key (variant_id, garment_id)
    references public.garment_variants (id, garment_id) on delete restrict,

  unique (session_id, request_id)
);

comment on table public.size_recommendation_events is
  'Size suggestion and the size actually chosen. Confidence is a suggestion, never a measurement.';
comment on column public.size_recommendation_events.accepted_size is
  'Customer''s final choice, used to measure recommendation quality.';

-- ---------------------------------------------------------------------------
-- tryon_jobs
--
-- Asynchronous, explicitly consented, and entirely outside the live mirror
-- loop. The realtime pipeline must never wait on this.
-- ---------------------------------------------------------------------------
create table public.tryon_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  shop_id uuid not null,
  session_id uuid not null,
  garment_id uuid not null,
  variant_id uuid not null,

  -- NOT NULL: no consent, no job. Enforced by the database, not by a code
  -- path that could be refactored away.
  consent_id uuid not null,

  status public.tryon_job_status not null default 'QUEUED',
  input_path text check (length(btrim(input_path)) between 1 and 1024),
  output_path text check (length(btrim(output_path)) between 1 and 1024),

  -- Uploaded source imagery is temporary by default; a sweeper deletes it.
  input_expires_at timestamptz,

  error_code text check (length(btrim(error_code)) between 1 and 80),

  queued_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  foreign key (session_id, organization_id)
    references public.sessions (id, organization_id) on delete cascade,
  foreign key (session_id, shop_id)
    references public.sessions (id, shop_id) on delete cascade,
  foreign key (consent_id, session_id)
    references public.consents (id, session_id) on delete restrict,
  foreign key (variant_id, garment_id)
    references public.garment_variants (id, garment_id) on delete restrict,

  constraint tryon_jobs_finished_consistency check (
    case
      when status in ('SUCCEEDED', 'FAILED', 'CANCELLED') then finished_at is not null
      else finished_at is null
    end
  ),
  constraint tryon_jobs_failure_has_code check (
    status <> 'FAILED' or error_code is not null
  )
);

comment on table public.tryon_jobs is
  'Async photorealistic try-on. Requires a consent row; never blocks the live mirror.';

-- ---------------------------------------------------------------------------
-- audit_logs
--
-- Append-only. No UPDATE or DELETE policy exists for any client role, so an
-- audit entry cannot be edited or erased through the Data API even by an
-- organization owner.
-- ---------------------------------------------------------------------------
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,

  actor_kind public.actor_kind not null,
  actor_staff_id uuid,
  actor_display_id uuid,

  action text not null check (length(btrim(action)) between 1 and 80),
  entity_type text not null check (length(btrim(entity_type)) between 1 and 80),
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,

  ip_address inet,
  user_agent text check (length(user_agent) <= 500),

  created_at timestamptz not null default now(),

  foreign key (actor_staff_id, organization_id)
    references public.staff_users (id, organization_id) on delete set null,
  foreign key (actor_display_id, organization_id)
    references public.displays (id, organization_id) on delete set null,

  -- A staff action must name the staff member; a device action must name the
  -- device. Prevents an unattributable entry from being written.
  constraint audit_logs_actor_matches_kind check (
    case actor_kind
      when 'STAFF' then actor_staff_id is not null and actor_display_id is null
      when 'DEVICE' then actor_display_id is not null and actor_staff_id is null
      else actor_staff_id is null and actor_display_id is null
    end
  )
);

comment on table public.audit_logs is
  'Append-only audit trail. No client role may update or delete a row.';

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
create index recommendation_events_organization_id_idx
  on public.recommendation_events (organization_id);
create index recommendation_events_shop_id_idx on public.recommendation_events (shop_id);
create index recommendation_events_session_id_idx on public.recommendation_events (session_id);

create index size_recommendation_events_organization_id_idx
  on public.size_recommendation_events (organization_id);
create index size_recommendation_events_shop_id_idx
  on public.size_recommendation_events (shop_id);
create index size_recommendation_events_session_id_idx
  on public.size_recommendation_events (session_id);
create index size_recommendation_events_garment_id_idx
  on public.size_recommendation_events (garment_id);
create index size_recommendation_events_variant_id_idx
  on public.size_recommendation_events (variant_id);

create index tryon_jobs_organization_id_idx on public.tryon_jobs (organization_id);
create index tryon_jobs_shop_id_idx on public.tryon_jobs (shop_id);
create index tryon_jobs_session_id_idx on public.tryon_jobs (session_id);
create index tryon_jobs_garment_id_idx on public.tryon_jobs (garment_id);
create index tryon_jobs_variant_id_idx on public.tryon_jobs (variant_id);
create index tryon_jobs_consent_id_idx on public.tryon_jobs (consent_id);
-- Worker picks up pending jobs oldest first.
create index tryon_jobs_pending_idx on public.tryon_jobs (queued_at)
  where status in ('QUEUED', 'RUNNING');
-- Sweeper finds expired uploads to delete.
create index tryon_jobs_input_expiry_idx on public.tryon_jobs (input_expires_at)
  where input_expires_at is not null;

create index audit_logs_organization_created_idx
  on public.audit_logs (organization_id, created_at desc);
create index audit_logs_actor_staff_id_idx on public.audit_logs (actor_staff_id)
  where actor_staff_id is not null;
create index audit_logs_actor_display_id_idx on public.audit_logs (actor_display_id)
  where actor_display_id is not null;
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);

-- ---------------------------------------------------------------------------
-- updated_at trigger
-- ---------------------------------------------------------------------------
create trigger tryon_jobs_set_updated_at
  before update on public.tryon_jobs
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.recommendation_events enable row level security;
alter table public.recommendation_events force row level security;
alter table public.size_recommendation_events enable row level security;
alter table public.size_recommendation_events force row level security;
alter table public.tryon_jobs enable row level security;
alter table public.tryon_jobs force row level security;
alter table public.audit_logs enable row level security;
alter table public.audit_logs force row level security;

create policy recommendation_events_select on public.recommendation_events
  for select to authenticated
  using (
    organization_id = (select app.current_org_id())
    and (select app.can_access_shop(shop_id))
  );

create policy size_recommendation_events_select on public.size_recommendation_events
  for select to authenticated
  using (
    organization_id = (select app.current_org_id())
    and (select app.can_access_shop(shop_id))
  );

create policy tryon_jobs_select on public.tryon_jobs
  for select to authenticated
  using (
    organization_id = (select app.current_org_id())
    and (select app.can_access_shop(shop_id))
  );

-- Audit is admin-readable and nothing more. Writes come from trusted server
-- code holding the secret key; the absence of INSERT/UPDATE/DELETE policies
-- is what makes the trail tamper-evident.
create policy audit_logs_select on public.audit_logs
  for select to authenticated
  using (
    organization_id = (select app.current_org_id())
    and (select app.current_role_rank()) >= 3
  );
