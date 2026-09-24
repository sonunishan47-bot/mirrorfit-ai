-- MirrorFit AI - privilege hardening
--
-- Fixes a real hole and adds defence in depth.
--
-- The hole
-- --------
-- The previous migrations used `revoke select (secret_hash) ... from
-- authenticated` to hide credential and pairing hashes. That does nothing.
-- Supabase grants table-wide SELECT to `authenticated`, and a column-level
-- revoke cannot subtract from a table-level grant: Postgres checks the table
-- grant first and stops. Verified against information_schema, which still
-- reported the privilege after the revoke.
--
-- The working form is to revoke at table level and then grant back only the
-- columns that are safe, which is what this migration does.
--
-- Consequence you must know about
-- -------------------------------
-- Once a table has column grants instead of a table grant, `select *` against
-- it is denied outright, because the star expands to a column the role cannot
-- read. supabase-js defaults to `*`, so `.from('sessions').select()` will fail.
-- Query these two tables with an explicit column list:
--
--   .from('sessions').select('id, status, display_id, started_at')
--
-- This is deliberate. The failure is loud and happens the first time someone
-- writes the query, rather than silently shipping a pairing verifier to a
-- browser. Verified in-database: explicit columns succeed, `select *` raises
-- insufficient_privilege.
--
-- Defence in depth
-- ----------------
-- RLS already denies everything to `anon` and denies unpolicied verbs to
-- `authenticated`. Removing the underlying grants as well means a future
-- migration that accidentally adds a permissive policy still cannot expose
-- these tables, because the privilege is not there to use.

-- ---------------------------------------------------------------------------
-- device_credentials: never expose secret_hash
-- ---------------------------------------------------------------------------
revoke all on public.device_credentials from authenticated;

grant select (
  id,
  organization_id,
  shop_id,
  display_id,
  label,
  issued_at,
  expires_at,
  revoked_at,
  last_used_at,
  created_at
) on public.device_credentials to authenticated;

-- Revocation is the only field an admin needs to write. Rotation and issuance
-- happen server-side because they require generating the secret.
grant update (label, revoked_at) on public.device_credentials to authenticated;

-- ---------------------------------------------------------------------------
-- sessions: never expose pairing_token_hash
--
-- Reading this would let a staff account derive nothing directly, but it is
-- the verifier for an in-flight pairing and has no business in a browser.
-- ---------------------------------------------------------------------------
revoke all on public.sessions from authenticated;

grant select (
  id,
  organization_id,
  shop_id,
  display_id,
  status,
  pairing_expires_at,
  pairing_claimed_at,
  pairing_revoked_at,
  locale,
  started_at,
  ended_at,
  end_reason,
  last_activity_at,
  created_at,
  updated_at
) on public.sessions to authenticated;

-- ---------------------------------------------------------------------------
-- Read-only and append-only tables
--
-- These have SELECT policies and no write policies. Dropping the write
-- grants makes that intent explicit at the privilege layer too.
-- ---------------------------------------------------------------------------
revoke insert, update, delete, truncate on
  public.device_heartbeats,
  public.session_events,
  public.consents,
  public.recommendation_events,
  public.size_recommendation_events,
  public.tryon_jobs
from authenticated;

-- audit_logs is append-only from trusted server code and immutable to
-- everyone else. An organization owner must not be able to erase their trail.
revoke insert, update, delete, truncate on public.audit_logs from authenticated;

-- Tenant provisioning and deletion are not in-tenant operations.
revoke insert, delete, truncate on public.organizations from authenticated;

-- A customer request is created by a customer through a server route and
-- progressed by staff. Staff never create or delete one.
revoke insert, delete, truncate on public.customer_requests from authenticated;

-- ---------------------------------------------------------------------------
-- anon has no business anywhere
--
-- Customers reach the system through server routes, never the Data API, so
-- the anonymous role needs no table access at all. No policy grants it
-- anything today; this removes the grants underneath as well.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;
