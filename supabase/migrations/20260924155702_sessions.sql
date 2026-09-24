-- MirrorFit AI - sessions, events, customer requests, consent
--
-- Pairing security
-- ----------------
-- The mirror asks the server for a session. The server generates a random
-- token, returns it once for the QR code, and stores only a keyed hash. A
-- scanned token is therefore useless to anyone who later reads this table.
--
-- Single-use is enforced by the claim being an atomic conditional update
-- (`set pairing_claimed_at = now() where pairing_claimed_at is null`), which
-- is why `pairing_claimed_at` is nullable rather than a boolean: the NULL is
-- the thing being competed for, so two phones racing on one QR code cannot
-- both win.
--
-- No customer identity is stored anywhere here. A session is the only handle
-- a customer has, and it dies with the session.

-- Needed so customer_requests can prove its acknowledging staff member
-- belongs to the same organization.
alter table public.staff_users
  add constraint staff_users_id_organization_id_key unique (id, organization_id);

-- ---------------------------------------------------------------------------
-- sessions
-- ---------------------------------------------------------------------------
create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  shop_id uuid not null,
  display_id uuid not null,

  status public.session_status not null default 'WAITING',

  -- SHA-256 of the pairing token. The plaintext exists only in the QR code
  -- on screen and in the URL the customer's phone opens.
  pairing_token_hash text not null unique check (pairing_token_hash ~ '^[0-9a-f]{64}$'),
  pairing_expires_at timestamptz not null,
  pairing_claimed_at timestamptz,
  pairing_revoked_at timestamptz,

  locale text not null default 'en' check (locale in ('en', 'ar')),

  started_at timestamptz,
  ended_at timestamptz,
  end_reason public.session_end_reason,
  last_activity_at timestamptz not null default now(),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  foreign key (shop_id, organization_id)
    references public.shops (id, organization_id) on delete cascade,
  foreign key (display_id, organization_id)
    references public.displays (id, organization_id) on delete cascade,
  foreign key (display_id, shop_id)
    references public.displays (id, shop_id) on delete cascade,

  unique (id, organization_id),
  unique (id, shop_id),

  -- A terminal session must say when and why it ended; a live one must not
  -- pretend it has. Keeps the state machine in `@mirrorfit/types` honest at
  -- the storage layer too.
  constraint sessions_terminal_consistency check (
    case
      when status in ('ENDED', 'EXPIRED') then ended_at is not null and end_reason is not null
      else ended_at is null and end_reason is null
    end
  ),

  constraint sessions_pairing_window check (pairing_expires_at > created_at),

  -- ACTIVE is only reachable through a successful claim.
  constraint sessions_active_requires_claim check (
    status <> 'ACTIVE' or pairing_claimed_at is not null
  )
);

comment on table public.sessions is
  'One customer fitting session on one mirror. Holds no customer identity.';
comment on column public.sessions.pairing_token_hash is
  'SHA-256 of the pairing token. Plaintext is never stored.';
comment on column public.sessions.pairing_claimed_at is
  'NULL until claimed. Single-use is enforced by an atomic conditional update on this column.';

-- ---------------------------------------------------------------------------
-- session_events
--
-- Append-only protocol log. `type` is text rather than an enum because the
-- wire protocol versions independently of the database; a new message type
-- must not require a migration before it can be recorded.
-- ---------------------------------------------------------------------------
create table public.session_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  shop_id uuid not null,
  session_id uuid not null,

  message_id uuid not null,
  type text not null check (length(btrim(type)) between 1 and 64),
  actor_kind public.actor_kind not null,
  protocol_version int not null check (protocol_version > 0),
  payload jsonb not null default '{}'::jsonb,

  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),

  foreign key (session_id, organization_id)
    references public.sessions (id, organization_id) on delete cascade,
  foreign key (session_id, shop_id)
    references public.sessions (id, shop_id) on delete cascade,

  -- The protocol's message_id doubles as an idempotency key, so a retried
  -- delivery cannot be recorded twice.
  unique (session_id, message_id)
);

comment on table public.session_events is
  'Append-only log of protocol messages. message_id gives replay idempotency.';

-- ---------------------------------------------------------------------------
-- customer_requests
-- ---------------------------------------------------------------------------
create table public.customer_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  shop_id uuid not null,
  session_id uuid not null,
  garment_id uuid not null,
  variant_id uuid not null,

  size_label public.size_label not null,
  status public.customer_request_status not null default 'REQUESTED',
  note text check (length(note) <= 1000),

  requested_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid,
  fulfilled_at timestamptz,
  cancelled_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  foreign key (session_id, organization_id)
    references public.sessions (id, organization_id) on delete cascade,
  foreign key (session_id, shop_id)
    references public.sessions (id, shop_id) on delete cascade,
  foreign key (variant_id, garment_id)
    references public.garment_variants (id, garment_id) on delete restrict,
  foreign key (garment_id, organization_id)
    references public.garments (id, organization_id) on delete restrict,
  foreign key (acknowledged_by, organization_id)
    references public.staff_users (id, organization_id) on delete set null,

  constraint customer_requests_acknowledged_consistency check (
    (acknowledged_at is null) = (acknowledged_by is null)
  ),
  constraint customer_requests_status_timestamps check (
    case status
      when 'ACKNOWLEDGED' then acknowledged_at is not null
      when 'FULFILLED' then fulfilled_at is not null
      when 'CANCELLED' then cancelled_at is not null
      else true
    end
  )
);

comment on table public.customer_requests is
  'A "bring this to me" request raised from the customer phone. No account required.';

-- ---------------------------------------------------------------------------
-- consents
--
-- A consent record exists only where one is genuinely required. Nothing here
-- stores an image; it records that a specific, purpose-scoped permission was
-- given for a specific session.
-- ---------------------------------------------------------------------------
create table public.consents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  shop_id uuid not null,
  session_id uuid not null,

  kind public.consent_kind not null,
  granted boolean not null,
  policy_version text not null check (length(btrim(policy_version)) between 1 and 40),

  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),

  foreign key (session_id, organization_id)
    references public.sessions (id, organization_id) on delete cascade,
  foreign key (session_id, shop_id)
    references public.sessions (id, shop_id) on delete cascade,

  unique (session_id, kind)
);

comment on table public.consents is
  'Purpose-specific, session-scoped consent record. Never a blanket permission.';

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
create index sessions_organization_id_idx on public.sessions (organization_id);
create index sessions_shop_id_idx on public.sessions (shop_id);
create index sessions_display_id_idx on public.sessions (display_id);
-- Sweeping expired sessions: find live ones past their pairing window.
create index sessions_pairing_expiry_idx on public.sessions (pairing_expires_at)
  where status in ('WAITING', 'PAIRED');
create index sessions_shop_created_idx on public.sessions (shop_id, created_at desc);

create index session_events_organization_id_idx on public.session_events (organization_id);
create index session_events_shop_id_idx on public.session_events (shop_id);
create index session_events_session_occurred_idx
  on public.session_events (session_id, occurred_at);

create index customer_requests_organization_id_idx on public.customer_requests (organization_id);
create index customer_requests_session_id_idx on public.customer_requests (session_id);
create index customer_requests_garment_id_idx on public.customer_requests (garment_id);
create index customer_requests_variant_id_idx on public.customer_requests (variant_id);
create index customer_requests_acknowledged_by_idx on public.customer_requests (acknowledged_by)
  where acknowledged_by is not null;
-- The staff queue: open requests for my shop, oldest first.
create index customer_requests_open_queue_idx
  on public.customer_requests (shop_id, requested_at)
  where status in ('REQUESTED', 'ACKNOWLEDGED');

create index consents_organization_id_idx on public.consents (organization_id);
create index consents_shop_id_idx on public.consents (shop_id);
create index consents_session_id_idx on public.consents (session_id);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
create trigger sessions_set_updated_at
  before update on public.sessions
  for each row execute function app.set_updated_at();

create trigger customer_requests_set_updated_at
  before update on public.customer_requests
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row level security
--
-- Sessions are created and mutated by trusted server routes on behalf of a
-- mirror or a phone, neither of which is an authenticated database user.
-- Staff therefore get read access for monitoring, and write access only
-- where a human genuinely acts: working the customer request queue.
-- ---------------------------------------------------------------------------
alter table public.sessions enable row level security;
alter table public.sessions force row level security;
alter table public.session_events enable row level security;
alter table public.session_events force row level security;
alter table public.customer_requests enable row level security;
alter table public.customer_requests force row level security;
alter table public.consents enable row level security;
alter table public.consents force row level security;

create policy sessions_select on public.sessions
  for select to authenticated
  using (
    organization_id = (select app.current_org_id())
    and (select app.can_access_shop(shop_id))
  );

-- The token hash is never needed by a browser, and reading it would allow
-- hijacking a pending pairing.
revoke select (pairing_token_hash) on public.sessions from authenticated;

create policy session_events_select on public.session_events
  for select to authenticated
  using (
    organization_id = (select app.current_org_id())
    and (select app.can_access_shop(shop_id))
  );

create policy customer_requests_select on public.customer_requests
  for select to authenticated
  using (
    organization_id = (select app.current_org_id())
    and (select app.can_access_shop(shop_id))
  );

-- Any staff member can work the queue; that is the entire point of the
-- feature. They cannot create or delete a request, only progress one.
create policy customer_requests_update on public.customer_requests
  for update to authenticated
  using (
    organization_id = (select app.current_org_id())
    and (select app.can_access_shop(shop_id))
    and (select app.current_role_rank()) >= 1
  )
  with check (
    organization_id = (select app.current_org_id())
    and (select app.can_access_shop(shop_id))
  );

create policy consents_select on public.consents
  for select to authenticated
  using (
    organization_id = (select app.current_org_id())
    and (select app.can_access_shop(shop_id))
  );
