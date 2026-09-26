/**
 * Staff ops shop resolution.
 *
 * Shop-scoped staff can never be widened by a client `shop_id` query.
 * Org-wide staff may pass a shop UUID; RLS still enforces org membership.
 * Client-supplied organization_id is never accepted.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function resolveOpsShopId(
  staffShopId: string | null,
  shopParam: string | null | undefined,
): string | null {
  if (staffShopId) return staffShopId;
  if (typeof shopParam === 'string' && UUID_RE.test(shopParam)) return shopParam;
  return null;
}

/** True when a query string attempts to smuggle tenancy (always reject). */
export function opsQueryAttemptsTenantOverride(searchParams: URLSearchParams): boolean {
  return (
    searchParams.has('organization_id') ||
    searchParams.has('org_id') ||
    searchParams.has('organizationId')
  );
}
