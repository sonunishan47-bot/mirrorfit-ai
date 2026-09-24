-- MirrorFit AI - tenancy
--
-- organizations -> shops -> staff_users, plus the RLS helper functions that
-- every later migration depends on.
--
-- Tenancy model
-- -------------
-- Three kinds of principal reach this database, and only one of them is an
-- authenticated Postgres role:
--
--   STAFF    Supabase Auth user. Mapped to an organization and role by
--            `staff_users`. Governed entirely by RLS.
--   DEVICE   A mirror. Deliberately NOT an auth user; it holds device
--            credentials and talks to trusted server routes, which use the
--            secret key. It has no direct database identity.
--   CUSTOMER Anonymous, account-less, scoped to one session. Same as above:
--            reaches the database only through server routes.
--
-- So `anon` gets no policy on any table anywhere. Absence of a policy under
-- RLS is a denial, which makes deny-by-default the structural default rather
-- than something each migration has to remember.

-- ---------------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 200),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 64),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.organizations is
  'Top-level tenant. A retail company that owns one or more shops.';

-- ---------------------------------------------------------------------------
-- shops
-- ---------------------------------------------------------------------------
create table public.shops (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 200),
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 64),
  timezone text not null default 'UTC' check (length(timezone) between 1 and 64),
  default_locale text not null default 'en' check (default_locale in ('en', 'ar')),
  address_line text check (length(address_line) <= 300),
  city text check (length(city) <= 120),
  country_code char(2) check (country_code ~ '^[A-Z]{2}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (organization_id, slug),

  -- Composite-unique so descendant tables can foreign-key on
  -- (shop_id, organization_id). That makes a row whose organization_id
  -- disagrees with its shop's organization_id structurally impossible,
  -- rather than something RLS has to be trusted to catch.
  unique (id, organization_id)
);

comment on table public.shops is
  'A physical retail location belonging to exactly one organization.';

-- ---------------------------------------------------------------------------
-- staff_users
-- ---------------------------------------------------------------------------
create table public.staff_users (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  auth_user_id uuid not null unique references auth.users (id) on delete cascade,

  -- NULL means organization-wide. A non-null value scopes this person to a
  -- single shop. Widening a manager to several shops means a join table
  -- later; the helper functions are the only thing that would change.
  shop_id uuid,

  role public.staff_role not null,
  full_name text check (length(btrim(full_name)) between 1 and 200),
  email text not null check (length(email) between 3 and 320),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- MATCH SIMPLE: when shop_id is NULL the constraint is satisfied, which is
  -- exactly the organization-wide case.
  foreign key (shop_id, organization_id)
    references public.shops (id, organization_id) on delete restrict,

  constraint staff_scope_matches_role check (
    (role in ('ORG_OWNER', 'ADMIN') and shop_id is null)
    or role in ('MANAGER', 'STAFF')
  )
);

comment on table public.staff_users is
  'Maps a Supabase Auth user to an organization, a role, and optionally one shop.';
comment on column public.staff_users.shop_id is
  'NULL = organization-wide access. Non-null = scoped to that shop only.';

-- ---------------------------------------------------------------------------
-- Indexes
--
-- Every foreign key gets an index: Postgres does not create one automatically,
-- and an unindexed FK turns a parent delete into a sequential scan of the
-- child table. These columns are also the ones RLS filters on.
-- ---------------------------------------------------------------------------
create index shops_organization_id_idx on public.shops (organization_id);
create index staff_users_organization_id_idx on public.staff_users (organization_id);
create index staff_users_shop_id_idx on public.staff_users (shop_id) where shop_id is not null;

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
create trigger organizations_set_updated_at
  before update on public.organizations
  for each row execute function app.set_updated_at();

create trigger shops_set_updated_at
  before update on public.shops
  for each row execute function app.set_updated_at();

create trigger staff_users_set_updated_at
  before update on public.staff_users
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS helper functions
--
-- All are SECURITY DEFINER. That is not a convenience: the policy on
-- `staff_users` needs to read `staff_users`, and a policy that re-enters its
-- own table under RLS recurses infinitely. Running as the definer bypasses
-- RLS inside the function and breaks the cycle.
--
-- `search_path = ''` forces every reference to be schema-qualified, so a
-- caller cannot shadow `staff_users` with a temp table and impersonate
-- another organization.
--
-- They live in `app`, never `public`. PostgREST only exposes the schemas it
-- is configured with, so nothing here is reachable through the Data API even
-- though `authenticated` can execute it inside a policy.
-- ---------------------------------------------------------------------------
grant usage on schema app to authenticated;

create or replace function app.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.organization_id
  from public.staff_users s
  where s.auth_user_id = (select auth.uid())
    and s.is_active
  limit 1;
$$;

comment on function app.current_org_id() is
  'Organization of the calling staff user, or NULL if the caller is not active staff.';

create or replace function app.current_shop_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.shop_id
  from public.staff_users s
  where s.auth_user_id = (select auth.uid())
    and s.is_active
  limit 1;
$$;

comment on function app.current_shop_id() is
  'Shop the caller is scoped to, or NULL for organization-wide access.';

create or replace function app.role_rank(target_role public.staff_role)
returns int
language sql
immutable
set search_path = ''
as $$
  select case target_role
    when 'ORG_OWNER' then 4
    when 'ADMIN' then 3
    when 'MANAGER' then 2
    when 'STAFF' then 1
  end;
$$;

comment on function app.role_rank(public.staff_role) is
  'Orders roles so policies can express "at least manager" without listing every role.';

create or replace function app.current_role_rank()
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select app.role_rank(s.role)
      from public.staff_users s
      where s.auth_user_id = (select auth.uid())
        and s.is_active
      limit 1
    ),
    0
  );
$$;

comment on function app.current_role_rank() is
  'Rank of the caller''s role, or 0 when the caller is not active staff.';

-- A shop-scoped staff member may only touch rows for their own shop.
-- Organization-wide staff (shop_id IS NULL) pass for every shop in the org.
create or replace function app.can_access_shop(target_shop_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.staff_users s
    where s.auth_user_id = (select auth.uid())
      and s.is_active
      and (s.shop_id is null or s.shop_id = target_shop_id)
  );
$$;

comment on function app.can_access_shop(uuid) is
  'True when the caller''s shop scope permits the given shop. Does not check organization; pair it with an organization_id predicate.';

revoke execute on function
  app.current_org_id(),
  app.current_shop_id(),
  app.role_rank(public.staff_role),
  app.current_role_rank(),
  app.can_access_shop(uuid)
from public;

grant execute on function
  app.current_org_id(),
  app.current_shop_id(),
  app.role_rank(public.staff_role),
  app.current_role_rank(),
  app.can_access_shop(uuid)
to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Row level security
--
-- `force` applies RLS to the table owner too. The `service_role` used by
-- trusted server code holds BYPASSRLS and is unaffected, so this only closes
-- the accidental-owner-access hole.
--
-- Helper calls are wrapped in `(select ...)` so Postgres evaluates them once
-- per statement as an InitPlan instead of once per row.
-- ---------------------------------------------------------------------------
alter table public.organizations enable row level security;
alter table public.organizations force row level security;
alter table public.shops enable row level security;
alter table public.shops force row level security;
alter table public.staff_users enable row level security;
alter table public.staff_users force row level security;

-- organizations: readable by its own staff; renameable by admins.
-- No INSERT or DELETE policy: provisioning a tenant is an operation for
-- trusted server code, not for someone who is already inside a tenant.
create policy organizations_select on public.organizations
  for select to authenticated
  using (id = (select app.current_org_id()));

create policy organizations_update on public.organizations
  for update to authenticated
  using (id = (select app.current_org_id()) and (select app.current_role_rank()) >= 3)
  with check (id = (select app.current_org_id()));

-- shops
create policy shops_select on public.shops
  for select to authenticated
  using (
    organization_id = (select app.current_org_id())
    and (select app.can_access_shop(id))
  );

create policy shops_insert on public.shops
  for insert to authenticated
  with check (
    organization_id = (select app.current_org_id())
    and (select app.current_role_rank()) >= 3
  );

create policy shops_update on public.shops
  for update to authenticated
  using (
    organization_id = (select app.current_org_id())
    and (select app.current_role_rank()) >= 3
  )
  with check (organization_id = (select app.current_org_id()));

create policy shops_delete on public.shops
  for delete to authenticated
  using (
    organization_id = (select app.current_org_id())
    and (select app.current_role_rank()) >= 3
  );

-- staff_users: the whole org directory is readable by any active staff
-- member; only admins may change it.
create policy staff_users_select on public.staff_users
  for select to authenticated
  using (organization_id = (select app.current_org_id()));

-- `app.role_rank(role) <= app.current_role_rank()` stops privilege
-- escalation: an admin cannot mint an owner, and nobody can promote someone
-- above themselves.
create policy staff_users_insert on public.staff_users
  for insert to authenticated
  with check (
    organization_id = (select app.current_org_id())
    and (select app.current_role_rank()) >= 3
    and app.role_rank(role) <= (select app.current_role_rank())
  );

create policy staff_users_update on public.staff_users
  for update to authenticated
  using (
    organization_id = (select app.current_org_id())
    and (select app.current_role_rank()) >= 3
  )
  with check (
    organization_id = (select app.current_org_id())
    and app.role_rank(role) <= (select app.current_role_rank())
  );

create policy staff_users_delete on public.staff_users
  for delete to authenticated
  using (
    organization_id = (select app.current_org_id())
    and (select app.current_role_rank()) >= 3
    and app.role_rank(role) <= (select app.current_role_rank())
  );
