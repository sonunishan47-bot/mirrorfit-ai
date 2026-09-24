-- MirrorFit AI - index and policy tuning
--
-- Fixes two findings from the Supabase performance advisor.
--
-- 1. Unindexed composite foreign keys (41)
--    Tenancy is denormalised, so most foreign keys are composite, e.g.
--    (shop_id, organization_id). A single-column index on shop_id does not
--    cover that constraint, which turns every parent delete into a
--    sequential scan of the child table. Replaced with composites whose
--    leading column matches the old single-column index, so the shop-scoped
--    RLS predicates keep their index too.
--
-- 2. Multiple permissive policies (5)
--    The catalog tables used `FOR ALL` write policies, which also apply to
--    SELECT. Every read was therefore evaluating two policies. Split into
--    explicit INSERT/UPDATE/DELETE so SELECT matches exactly one.
--
-- The advisor's third finding, 67 unused indexes, is expected: the database
-- has served no queries yet. Dropping indexes on that basis would remove the
-- ones the product is about to depend on.

-- ---------------------------------------------------------------------------
-- Composite foreign key indexes
-- ---------------------------------------------------------------------------
create index staff_users_shop_org_idx on public.staff_users (shop_id, organization_id);

create index displays_shop_org_idx on public.displays (shop_id, organization_id);

create index device_credentials_display_org_idx
  on public.device_credentials (display_id, organization_id);
create index device_credentials_display_shop_idx
  on public.device_credentials (display_id, shop_id);

create index device_heartbeats_display_org_idx
  on public.device_heartbeats (display_id, organization_id);
create index device_heartbeats_display_shop_idx
  on public.device_heartbeats (display_id, shop_id);

create index installations_display_org_idx on public.installations (display_id, organization_id);
create index installations_display_shop_idx on public.installations (display_id, shop_id);
create index installations_shop_org_idx on public.installations (shop_id, organization_id);

create index garments_shop_org_idx on public.garments (shop_id, organization_id);

create index garment_variants_garment_org_idx
  on public.garment_variants (garment_id, organization_id);
create index garment_variants_garment_shop_idx
  on public.garment_variants (garment_id, shop_id);

create index garment_assets_garment_org_idx
  on public.garment_assets (garment_id, organization_id);
create index garment_assets_variant_garment_idx
  on public.garment_assets (variant_id, garment_id);

create index size_charts_garment_org_idx on public.size_charts (garment_id, organization_id);
create index size_charts_shop_org_idx on public.size_charts (shop_id, organization_id);

create index size_measurements_chart_org_idx
  on public.size_measurements (size_chart_id, organization_id);
create index size_measurements_chart_shop_idx
  on public.size_measurements (size_chart_id, shop_id);

create index sessions_display_org_idx on public.sessions (display_id, organization_id);
create index sessions_display_shop_idx on public.sessions (display_id, shop_id);
create index sessions_shop_org_idx on public.sessions (shop_id, organization_id);

create index session_events_session_org_idx on public.session_events (session_id, organization_id);
create index session_events_session_shop_idx on public.session_events (session_id, shop_id);

create index customer_requests_ack_by_org_idx
  on public.customer_requests (acknowledged_by, organization_id);
create index customer_requests_garment_org_idx
  on public.customer_requests (garment_id, organization_id);
create index customer_requests_session_org_idx
  on public.customer_requests (session_id, organization_id);
create index customer_requests_session_shop_idx
  on public.customer_requests (session_id, shop_id);
create index customer_requests_variant_garment_idx
  on public.customer_requests (variant_id, garment_id);

create index consents_session_org_idx on public.consents (session_id, organization_id);
create index consents_session_shop_idx on public.consents (session_id, shop_id);

create index recommendation_events_session_org_idx
  on public.recommendation_events (session_id, organization_id);
create index recommendation_events_session_shop_idx
  on public.recommendation_events (session_id, shop_id);

create index size_recommendation_events_session_org_idx
  on public.size_recommendation_events (session_id, organization_id);
create index size_recommendation_events_session_shop_idx
  on public.size_recommendation_events (session_id, shop_id);
create index size_recommendation_events_variant_garment_idx
  on public.size_recommendation_events (variant_id, garment_id);

create index tryon_jobs_consent_session_idx on public.tryon_jobs (consent_id, session_id);
create index tryon_jobs_session_org_idx on public.tryon_jobs (session_id, organization_id);
create index tryon_jobs_session_shop_idx on public.tryon_jobs (session_id, shop_id);
create index tryon_jobs_variant_garment_idx on public.tryon_jobs (variant_id, garment_id);

create index audit_logs_actor_display_org_idx
  on public.audit_logs (actor_display_id, organization_id);
create index audit_logs_actor_staff_org_idx
  on public.audit_logs (actor_staff_id, organization_id);

-- ---------------------------------------------------------------------------
-- Drop indexes now redundant
--
-- Each of these is a strict leading-column prefix of a composite created
-- above, so the composite answers the same queries. Keeping both would cost
-- write throughput for no read benefit.
-- ---------------------------------------------------------------------------
drop index public.staff_users_shop_id_idx;
drop index public.displays_shop_id_idx;
drop index public.device_credentials_display_id_idx;
drop index public.installations_shop_id_idx;
drop index public.garments_shop_id_idx;
drop index public.garment_variants_garment_id_idx;
drop index public.garment_assets_garment_id_idx;
drop index public.garment_assets_variant_id_idx;
drop index public.size_charts_shop_id_idx;
drop index public.size_measurements_size_chart_id_idx;
drop index public.sessions_shop_id_idx;
drop index public.sessions_display_id_idx;
drop index public.customer_requests_session_id_idx;
drop index public.customer_requests_garment_id_idx;
drop index public.customer_requests_variant_id_idx;
drop index public.customer_requests_acknowledged_by_idx;
drop index public.consents_session_id_idx;
drop index public.recommendation_events_session_id_idx;
drop index public.size_recommendation_events_session_id_idx;
drop index public.size_recommendation_events_variant_id_idx;
drop index public.tryon_jobs_session_id_idx;
drop index public.tryon_jobs_variant_id_idx;
drop index public.tryon_jobs_consent_id_idx;
drop index public.audit_logs_actor_staff_id_idx;
drop index public.audit_logs_actor_display_id_idx;

-- ---------------------------------------------------------------------------
-- Split FOR ALL catalog policies into explicit verbs
-- ---------------------------------------------------------------------------
drop policy garments_write on public.garments;
drop policy garment_variants_write on public.garment_variants;
drop policy garment_assets_write on public.garment_assets;
drop policy size_charts_write on public.size_charts;
drop policy size_measurements_write on public.size_measurements;

-- garments
create policy garments_insert on public.garments
  for insert to authenticated
  with check (
    organization_id = (select app.current_org_id())
    and (select app.can_access_shop(shop_id))
    and (select app.current_role_rank()) >= 2
  );

create policy garments_update on public.garments
  for update to authenticated
  using (
    organization_id = (select app.current_org_id())
    and (select app.can_access_shop(shop_id))
    and (select app.current_role_rank()) >= 2
  )
  with check (
    organization_id = (select app.current_org_id())
    and (select app.can_access_shop(shop_id))
  );

create policy garments_delete on public.garments
  for delete to authenticated
  using (
    organization_id = (select app.current_org_id())
    and (select app.can_access_shop(shop_id))
    and (select app.current_role_rank()) >= 2
  );

-- garment_variants
create policy garment_variants_insert on public.garment_variants
  for insert to authenticated
  with check (
    organization_id = (select app.current_org_id())
    and (select app.can_access_shop(shop_id))
    and (select app.current_role_rank()) >= 2
  );

create policy garment_variants_update on public.garment_variants
  for update to authenticated
  using (
    organization_id = (select app.current_org_id())
    and (select app.can_access_shop(shop_id))
    and (select app.current_role_rank()) >= 2
  )
  with check (
    organization_id = (select app.current_org_id())
    and (select app.can_access_shop(shop_id))
  );

create policy garment_variants_delete on public.garment_variants
  for delete to authenticated
  using (
    organization_id = (select app.current_org_id())
    and (select app.can_access_shop(shop_id))
    and (select app.current_role_rank()) >= 2
  );

-- garment_assets
create policy garment_assets_insert on public.garment_assets
  for insert to authenticated
  with check (
    organization_id = (select app.current_org_id())
    and (select app.current_role_rank()) >= 2
  );

create policy garment_assets_update on public.garment_assets
  for update to authenticated
  using (
    organization_id = (select app.current_org_id())
    and (select app.current_role_rank()) >= 2
  )
  with check (organization_id = (select app.current_org_id()));

create policy garment_assets_delete on public.garment_assets
  for delete to authenticated
  using (
    organization_id = (select app.current_org_id())
    and (select app.current_role_rank()) >= 2
  );

-- size_charts
create policy size_charts_insert on public.size_charts
  for insert to authenticated
  with check (
    organization_id = (select app.current_org_id())
    and (select app.can_access_shop(shop_id))
    and (select app.current_role_rank()) >= 2
  );

create policy size_charts_update on public.size_charts
  for update to authenticated
  using (
    organization_id = (select app.current_org_id())
    and (select app.can_access_shop(shop_id))
    and (select app.current_role_rank()) >= 2
  )
  with check (
    organization_id = (select app.current_org_id())
    and (select app.can_access_shop(shop_id))
  );

create policy size_charts_delete on public.size_charts
  for delete to authenticated
  using (
    organization_id = (select app.current_org_id())
    and (select app.can_access_shop(shop_id))
    and (select app.current_role_rank()) >= 2
  );

-- size_measurements
create policy size_measurements_insert on public.size_measurements
  for insert to authenticated
  with check (
    organization_id = (select app.current_org_id())
    and (select app.can_access_shop(shop_id))
    and (select app.current_role_rank()) >= 2
  );

create policy size_measurements_update on public.size_measurements
  for update to authenticated
  using (
    organization_id = (select app.current_org_id())
    and (select app.can_access_shop(shop_id))
    and (select app.current_role_rank()) >= 2
  )
  with check (
    organization_id = (select app.current_org_id())
    and (select app.can_access_shop(shop_id))
  );

create policy size_measurements_delete on public.size_measurements
  for delete to authenticated
  using (
    organization_id = (select app.current_org_id())
    and (select app.can_access_shop(shop_id))
    and (select app.current_role_rank()) >= 2
  );
