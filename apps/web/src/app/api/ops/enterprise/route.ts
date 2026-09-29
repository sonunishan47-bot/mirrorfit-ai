import { NextResponse } from 'next/server';

import { clientError } from '@/lib/api/errors';
import { getStaffContext } from '@/lib/auth/staff';
import { loadOpsSnapshot } from '@/lib/ops/load-ops-snapshot';

export const dynamic = 'force-dynamic';

/**
 * Staff-only enterprise snapshot. Tenancy comes from the staff session.
 * No camera frames, storage paths, or device secrets.
 */
export async function GET(): Promise<NextResponse> {
  const staff = await getStaffContext();
  if (!staff) return clientError('UNAUTHORIZED');
  const snapshot = await loadOpsSnapshot(staff);
  return NextResponse.json(
    {
      brand: snapshot.brand,
      plan: snapshot.plan,
      limits: snapshot.limits,
      usage: snapshot.usage,
      analytics: snapshot.analytics,
      fleet: {
        online: snapshot.fleet.online,
        stale: snapshot.fleet.stale,
        offline: snapshot.fleet.offline,
        maintenance: snapshot.fleet.maintenance,
        revoked: snapshot.fleet.revoked,
      },
      inventory: snapshot.inventory,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
