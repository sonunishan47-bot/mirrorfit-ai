-- MirrorFit AI - garment catalog and size charts
--
-- A garment is never "one image". Assets are rows keyed by kind and version,
-- so adding depth maps, meshes or cloth-simulation parameters later is an
-- insert, not a schema change. Every asset carries a content hash, which is
-- what lets a mirror diff its local cache against the server manifest and
-- download only what actually changed.

-- ---------------------------------------------------------------------------
-- garments
-- ---------------------------------------------------------------------------
create table public.garments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  shop_id uuid not null,

  sku text not null check (length(btrim(sku)) between 1 and 64),
  name text not null check (length(btrim(name)) between 1 and 200),
  description text check (length(description) <= 4000),
  category text not null check (length(btrim(category)) between 1 and 80),
  brand text check (length(btrim(brand)) between 1 and 120),

  -- Money as integer minor units. Never floating point: 0.1 + 0.2 must not
  -- be a pricing question.
  price_minor bigint check (price_minor >= 0),
  currency_code char(3) check (currency_code ~ '^[A-Z]{3}$'),

  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  foreign key (shop_id, organization_id)
    references public.shops (id, organization_id) on delete cascade,

  unique (shop_id, sku),
  unique (id, organization_id),
  unique (id, shop_id),

  constraint garments_price_needs_currency
    check ((price_minor is null) = (currency_code is null))
);

comment on table public.garments is
  'A catalog item belonging to one shop. Colourways live in garment_variants.';

-- ---------------------------------------------------------------------------
-- garment_variants
-- ---------------------------------------------------------------------------
create table public.garment_variants (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  shop_id uuid not null,
  garment_id uuid not null,

  sku text check (length(btrim(sku)) between 1 and 64),
  color_name text not null check (length(btrim(color_name)) between 1 and 80),
  color_hex char(7) not null check (color_hex ~ '^#[0-9a-f]{6}$'),
  is_active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  foreign key (garment_id, organization_id)
    references public.garments (id, organization_id) on delete cascade,
  foreign key (garment_id, shop_id)
    references public.garments (id, shop_id) on delete cascade,

  unique (garment_id, color_name),
  unique (id, organization_id),
  unique (id, garment_id)
);

comment on table public.garment_variants is
  'One colourway of a garment. The unit a customer actually selects.';

-- ---------------------------------------------------------------------------
-- garment_assets
-- ---------------------------------------------------------------------------
create table public.garment_assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  garment_id uuid not null,

  -- NULL means the asset applies to every variant, e.g. a shared size guide.
  variant_id uuid,

  kind public.garment_asset_kind not null,
  version int not null default 1 check (version > 0),

  storage_bucket text not null default 'garment-assets'
    check (length(btrim(storage_bucket)) between 1 and 63),
  storage_path text not null check (length(btrim(storage_path)) between 1 and 1024),

  -- SHA-256 of the bytes. Drives mirror cache invalidation and integrity
  -- checking after download.
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),

  byte_size bigint check (byte_size > 0),
  width int check (width > 0),
  height int check (height > 0),
  mime_type text check (length(mime_type) <= 120),
  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),

  foreign key (garment_id, organization_id)
    references public.garments (id, organization_id) on delete cascade,
  foreign key (variant_id, garment_id)
    references public.garment_variants (id, garment_id) on delete cascade,

  -- NULLS NOT DISTINCT so the garment-wide case (variant_id IS NULL) is still
  -- deduplicated. Plain UNIQUE treats NULLs as distinct and would silently
  -- allow two THUMBNAIL v1 rows for the same garment.
  constraint garment_assets_unique_kind_version
    unique nulls not distinct (garment_id, variant_id, kind, version)
);

comment on table public.garment_assets is
  'Versioned, content-hashed binary assets. New kinds are new rows, not new columns.';
comment on column public.garment_assets.content_hash is
  'SHA-256 of the file. Used for offline cache diffing and download integrity.';

-- ---------------------------------------------------------------------------
-- size_charts
--
-- Per-garment by design. M from one brand is not M from another, so the size
-- engine must resolve against the chart attached to the specific garment.
-- ---------------------------------------------------------------------------
create table public.size_charts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  shop_id uuid not null,

  -- NULL allows a reusable shop-level chart; a garment-specific chart always
  -- takes precedence in the recommendation engine.
  garment_id uuid,

  name text not null check (length(btrim(name)) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  foreign key (shop_id, organization_id)
    references public.shops (id, organization_id) on delete cascade,
  foreign key (garment_id, organization_id)
    references public.garments (id, organization_id) on delete cascade,

  unique (id, organization_id),
  unique (id, shop_id)
);

-- At most one chart per garment.
create unique index size_charts_one_per_garment
  on public.size_charts (garment_id)
  where garment_id is not null;

comment on table public.size_charts is
  'A set of body measurements per size label, scoped to a garment or a shop.';

-- ---------------------------------------------------------------------------
-- size_measurements
-- ---------------------------------------------------------------------------
create table public.size_measurements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  shop_id uuid not null,
  size_chart_id uuid not null,

  size_label public.size_label not null,

  -- Centimetres. Nullable because a chart may specify only some dimensions;
  -- the recommendation engine scores on whichever are present.
  chest_cm numeric(5, 1) check (chest_cm > 0 and chest_cm <= 400),
  shoulder_cm numeric(5, 1) check (shoulder_cm > 0 and shoulder_cm <= 400),
  waist_cm numeric(5, 1) check (waist_cm > 0 and waist_cm <= 400),
  hip_cm numeric(5, 1) check (hip_cm > 0 and hip_cm <= 400),
  length_cm numeric(5, 1) check (length_cm > 0 and length_cm <= 400),
  sleeve_cm numeric(5, 1) check (sleeve_cm > 0 and sleeve_cm <= 400),
  inseam_cm numeric(5, 1) check (inseam_cm > 0 and inseam_cm <= 400),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  foreign key (size_chart_id, organization_id)
    references public.size_charts (id, organization_id) on delete cascade,
  foreign key (size_chart_id, shop_id)
    references public.size_charts (id, shop_id) on delete cascade,

  unique (size_chart_id, size_label)
);

comment on table public.size_measurements is
  'Measurements for one size label within a chart. NULL means not specified.';

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
create index garments_organization_id_idx on public.garments (organization_id);
create index garments_shop_id_idx on public.garments (shop_id);
-- Catalog browsing is always "active items in this shop, by category".
create index garments_shop_category_idx on public.garments (shop_id, category)
  where is_active;

create index garment_variants_organization_id_idx on public.garment_variants (organization_id);
create index garment_variants_shop_id_idx on public.garment_variants (shop_id);
create index garment_variants_garment_id_idx on public.garment_variants (garment_id);

create index garment_assets_organization_id_idx on public.garment_assets (organization_id);
create index garment_assets_garment_id_idx on public.garment_assets (garment_id);
create index garment_assets_variant_id_idx on public.garment_assets (variant_id)
  where variant_id is not null;
-- The offline manifest diff looks assets up by hash.
create index garment_assets_content_hash_idx on public.garment_assets (content_hash);

create index size_charts_organization_id_idx on public.size_charts (organization_id);
create index size_charts_shop_id_idx on public.size_charts (shop_id);

create index size_measurements_organization_id_idx on public.size_measurements (organization_id);
create index size_measurements_shop_id_idx on public.size_measurements (shop_id);
create index size_measurements_size_chart_id_idx on public.size_measurements (size_chart_id);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
create trigger garments_set_updated_at
  before update on public.garments
  for each row execute function app.set_updated_at();

create trigger garment_variants_set_updated_at
  before update on public.garment_variants
  for each row execute function app.set_updated_at();

create trigger size_charts_set_updated_at
  before update on public.size_charts
  for each row execute function app.set_updated_at();

create trigger size_measurements_set_updated_at
  before update on public.size_measurements
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row level security
--
-- Catalog editing is a manager-level task (rank >= 2), unlike device and
-- staff administration which require an admin.
-- ---------------------------------------------------------------------------
alter table public.garments enable row level security;
alter table public.garments force row level security;
alter table public.garment_variants enable row level security;
alter table public.garment_variants force row level security;
alter table public.garment_assets enable row level security;
alter table public.garment_assets force row level security;
alter table public.size_charts enable row level security;
alter table public.size_charts force row level security;
alter table public.size_measurements enable row level security;
alter table public.size_measurements force row level security;

create policy garments_select on public.garments
  for select to authenticated
  using (
    organization_id = (select app.current_org_id())
    and (select app.can_access_shop(shop_id))
  );

create policy garments_write on public.garments
  for all to authenticated
  using (
    organization_id = (select app.current_org_id())
    and (select app.can_access_shop(shop_id))
    and (select app.current_role_rank()) >= 2
  )
  with check (
    organization_id = (select app.current_org_id())
    and (select app.can_access_shop(shop_id))
    and (select app.current_role_rank()) >= 2
  );

create policy garment_variants_select on public.garment_variants
  for select to authenticated
  using (
    organization_id = (select app.current_org_id())
    and (select app.can_access_shop(shop_id))
  );

create policy garment_variants_write on public.garment_variants
  for all to authenticated
  using (
    organization_id = (select app.current_org_id())
    and (select app.can_access_shop(shop_id))
    and (select app.current_role_rank()) >= 2
  )
  with check (
    organization_id = (select app.current_org_id())
    and (select app.can_access_shop(shop_id))
    and (select app.current_role_rank()) >= 2
  );

-- garment_assets has no shop_id of its own; it inherits scope through its
-- garment, which the composite foreign key already pins to one organization.
create policy garment_assets_select on public.garment_assets
  for select to authenticated
  using (organization_id = (select app.current_org_id()));

create policy garment_assets_write on public.garment_assets
  for all to authenticated
  using (
    organization_id = (select app.current_org_id())
    and (select app.current_role_rank()) >= 2
  )
  with check (
    organization_id = (select app.current_org_id())
    and (select app.current_role_rank()) >= 2
  );

create policy size_charts_select on public.size_charts
  for select to authenticated
  using (
    organization_id = (select app.current_org_id())
    and (select app.can_access_shop(shop_id))
  );

create policy size_charts_write on public.size_charts
  for all to authenticated
  using (
    organization_id = (select app.current_org_id())
    and (select app.can_access_shop(shop_id))
    and (select app.current_role_rank()) >= 2
  )
  with check (
    organization_id = (select app.current_org_id())
    and (select app.can_access_shop(shop_id))
    and (select app.current_role_rank()) >= 2
  );

create policy size_measurements_select on public.size_measurements
  for select to authenticated
  using (
    organization_id = (select app.current_org_id())
    and (select app.can_access_shop(shop_id))
  );

create policy size_measurements_write on public.size_measurements
  for all to authenticated
  using (
    organization_id = (select app.current_org_id())
    and (select app.can_access_shop(shop_id))
    and (select app.current_role_rank()) >= 2
  )
  with check (
    organization_id = (select app.current_org_id())
    and (select app.can_access_shop(shop_id))
    and (select app.current_role_rank()) >= 2
  );
