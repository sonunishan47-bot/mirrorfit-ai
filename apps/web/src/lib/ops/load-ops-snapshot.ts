import 'server-only';

import {
  PLAN_LIMITS,
  gpuUsageEstimate,
  readPlan,
  usageAllowed,
  whiteLabel,
  type PlanId,
  type PlanLimits,
} from '@mirrorfit/experience';
import type { StaffContext } from '@/lib/auth/staff';
import { createSupabaseServerClient } from '@/lib/supabase/server-client';

import { aggregateShopAnalytics, type ShopAnalyticsSummary } from './analytics-aggregate';
import { summarizeInventoryDistribution, type InventoryDistribution } from './inventory-summary';
import { classifyDisplayHealth, summarizeKioskFleet, type DisplayHealthRow } from './kiosk-health';

export interface OpsSnapshot {
  readonly shop_id: string | null;
  readonly generated_at: string;
  readonly analytics: ShopAnalyticsSummary | null;
  readonly kiosks: readonly DisplayHealthRow[];
  readonly fleet: ReturnType<typeof summarizeKioskFleet>;
  readonly inventory: InventoryDistribution | null;
  readonly brand: { readonly title: string; readonly subtitle: string };
  readonly plan: PlanId;
  readonly limits: PlanLimits;
  readonly usage: {
    readonly still_jobs_today: number | null;
    readonly succeeded_stills_today: number | null;
    readonly gpu_estimate_seconds: number | null;
    readonly mirrors_online: number;
    readonly stills_allowed: boolean | null;
    readonly mirrors_allowed: boolean;
  };
}

/**
 * Staff-scoped operations snapshot.
 *
 * Tenancy comes from `staff` only. Shop filter uses the staff member's shop
 * when set; org-wide staff may pass an explicit shopId already known to belong
 * to their organization (verified by RLS — client-supplied org is never used).
 */
export async function loadOpsSnapshot(
  staff: StaffContext,
  options?: { readonly shopId?: string | null; readonly nowMs?: number },
): Promise<OpsSnapshot> {
  const supabase = await createSupabaseServerClient();
  const shopId = staff.shopId ?? options?.shopId ?? null;
  const nowMs = options?.nowMs ?? Date.now();

  const displaysQuery = supabase
    .from('displays')
    .select('id, name, shop_id, status, last_heartbeat_at, camera_ok, app_version')
    .order('name');
  if (shopId) displaysQuery.eq('shop_id', shopId);

  const sessionsQuery = supabase
    .from('sessions')
    .select('id, shop_id, status, created_at, started_at, ended_at, pairing_claimed_at')
    .order('created_at', { ascending: false })
    .limit(500);
  if (shopId) sessionsQuery.eq('shop_id', shopId);

  const eventsQuery = supabase
    .from('session_events')
    .select('session_id, shop_id, type, occurred_at, payload')
    .eq('type', 'GARMENT_SELECTED')
    .order('occurred_at', { ascending: false })
    .limit(1000);
  if (shopId) eventsQuery.eq('shop_id', shopId);

  const garmentsQuery = supabase
    .from('garments')
    .select('id, shop_id, category, is_active')
    .eq('is_active', true);
  if (shopId) garmentsQuery.eq('shop_id', shopId);

  const variantsQuery = supabase
    .from('garment_variants')
    .select('id, garment_id, shop_id, is_active')
    .eq('is_active', true);
  if (shopId) variantsQuery.eq('shop_id', shopId);

  const overlaysQuery = supabase
    .from('garment_assets')
    .select('garment_id, organization_id, kind')
    .eq('kind', 'OVERLAY');

  const [displays, sessions, events, garments, variants, overlays] = await Promise.all([
    displaysQuery,
    sessionsQuery,
    eventsQuery,
    garmentsQuery,
    variantsQuery,
    overlaysQuery,
  ]);

  const kiosks = (displays.data ?? []).map((row) =>
    classifyDisplayHealth(
      {
        id: row.id,
        name: row.name,
        shop_id: row.shop_id,
        status: row.status,
        last_heartbeat_at: row.last_heartbeat_at,
        camera_ok: row.camera_ok,
        app_version: row.app_version,
      },
      nowMs,
    ),
  );

  const analytics =
    shopId && sessions.data && events.data
      ? aggregateShopAnalytics(sessions.data, events.data, shopId)
      : shopId
        ? aggregateShopAnalytics([], [], shopId)
        : null;

  const inventory =
    shopId && garments.data && variants.data
      ? summarizeInventoryDistribution(
          garments.data,
          variants.data,
          (overlays.data ?? [])
            .filter((row) => row.organization_id === staff.organizationId)
            .map((row) => ({ garment_id: row.garment_id })),
          shopId,
        )
      : null;

  const fleet = summarizeKioskFleet(kiosks);
  const plan = readPlan(process.env['MIRRORFIT_PLAN']);
  const limits = PLAN_LIMITS[plan];
  const dayStart = new Date(nowMs);
  dayStart.setUTCHours(0, 0, 0, 0);
  const dayIso = dayStart.toISOString();

  const shopQuery = shopId
    ? supabase.from('shops').select('name').eq('id', shopId).maybeSingle()
    : Promise.resolve({ data: null, error: null });
  const orgQuery = supabase
    .from('organizations')
    .select('name')
    .eq('id', staff.organizationId)
    .maybeSingle();
  const jobsQuery = shopId
    ? supabase
        .from('tryon_jobs')
        .select('id', { count: 'exact', head: true })
        .eq('shop_id', shopId)
        .gte('queued_at', dayIso)
    : Promise.resolve({ count: null, error: null });
  const succeededQuery = shopId
    ? supabase
        .from('tryon_jobs')
        .select('id', { count: 'exact', head: true })
        .eq('shop_id', shopId)
        .eq('status', 'SUCCEEDED')
        .gte('queued_at', dayIso)
    : Promise.resolve({ count: null, error: null });

  const [shopRow, orgRow, jobs, succeeded] = await Promise.all([
    shopQuery,
    orgQuery,
    jobsQuery,
    succeededQuery,
  ]);

  const stillJobsToday = jobs.error ? null : (jobs.count ?? 0);
  const succeededToday = succeeded.error ? null : (succeeded.count ?? 0);
  const allowance =
    stillJobsToday === null
      ? null
      : usageAllowed(plan, { mirrorsOnline: fleet.online, stillJobsToday });

  return {
    shop_id: shopId,
    generated_at: new Date(nowMs).toISOString(),
    analytics,
    kiosks,
    fleet,
    inventory,
    brand: whiteLabel({
      shopName: shopRow.data?.name ?? null,
      organizationName: orgRow.data?.name ?? null,
    }),
    plan,
    limits,
    usage: {
      still_jobs_today: stillJobsToday,
      succeeded_stills_today: succeededToday,
      gpu_estimate_seconds:
        succeededToday === null ? null : gpuUsageEstimate(succeededToday).billableSeconds,
      mirrors_online: fleet.online,
      stills_allowed: allowance ? allowance.stills : null,
      mirrors_allowed: fleet.online <= limits.mirrors,
    },
  };
}
