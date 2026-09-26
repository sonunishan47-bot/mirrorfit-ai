import { NextResponse } from 'next/server';

import { getStaffContext } from '@/lib/auth/staff';
import { loadOpsSnapshot } from '@/lib/ops/load-ops-snapshot';
import { opsQueryAttemptsTenantOverride, resolveOpsShopId } from '@/lib/ops/ops-shop-scope';

export const dynamic = 'force-dynamic';

/**
 * Staff ops summary JSON.
 *
 * Auth is staff session only. Tenancy is resolved from the staff row — never
 * from a client-supplied organization_id. Response omits secrets and paths.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const staff = await getStaffContext();
  if (!staff) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  if (opsQueryAttemptsTenantOverride(url.searchParams)) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const shopId = resolveOpsShopId(staff.shopId, url.searchParams.get('shop_id'));
  const snapshot = await loadOpsSnapshot(staff, { shopId });
  const body = {
    shop_id: snapshot.shop_id,
    generated_at: snapshot.generated_at,
    analytics: snapshot.analytics,
    fleet: snapshot.fleet,
    kiosks: snapshot.kiosks.map((row) => ({
      display_id: row.display_id,
      name: row.name,
      shop_id: row.shop_id,
      health: row.health,
      camera_ok: row.camera_ok,
      app_version: row.app_version,
      minutes_since_heartbeat: row.minutes_since_heartbeat,
    })),
    inventory: snapshot.inventory,
  };

  const json = JSON.stringify(body);
  if (/storage_path|device_secret|pairing_token|overlay_url/i.test(json)) {
    return NextResponse.json({ error: 'internal' }, { status: 500 });
  }

  return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
}
