import type { StaffRole } from '@mirrorfit/types';
import { staffRoleRank } from '@mirrorfit/types';

export const PLAN_IDS = ['shop', 'brand', 'enterprise'] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export interface PlanLimits {
  readonly mirrors: number;
  readonly stillJobsPerDay: number;
  /** Included GPU seconds. 0 means photorealistic jobs stay blocked by plan. */
  readonly gpuSeconds: number;
}

export const PLAN_LIMITS: Readonly<Record<PlanId, PlanLimits>> = {
  shop: { mirrors: 2, stillJobsPerDay: 40, gpuSeconds: 0 },
  brand: { mirrors: 20, stillJobsPerDay: 400, gpuSeconds: 3_600 },
  enterprise: { mirrors: 200, stillJobsPerDay: 4_000, gpuSeconds: 28_800 },
};

export function readPlan(value: string | undefined | null): PlanId {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'brand' || normalized === 'enterprise' || normalized === 'shop')
    return normalized;
  return 'shop';
}

export function usageAllowed(
  plan: PlanId,
  usage: { readonly mirrorsOnline: number; readonly stillJobsToday: number },
): { readonly mirrors: boolean; readonly stills: boolean } {
  const limits = PLAN_LIMITS[plan];
  return {
    mirrors: usage.mirrorsOnline <= limits.mirrors,
    stills: usage.stillJobsToday < limits.stillJobsPerDay && limits.gpuSeconds > 0,
  };
}

/**
 * Accounting estimate for a succeeded still. Not a reading from the GPU, and
 * not a card charge. A shop plan with 0 GPU seconds does not become a bill.
 */
export function gpuUsageEstimate(succeededStills: number): {
  readonly billableSeconds: number;
  readonly note: string;
} {
  const count =
    Number.isFinite(succeededStills) && succeededStills > 0 ? Math.floor(succeededStills) : 0;
  return {
    billableSeconds: count * 8,
    note: '8 seconds per succeeded still is an estimate for quotas, not a measured GPU invoice.',
  };
}

export function whiteLabel(input: {
  readonly shopName: string | null;
  readonly organizationName: string | null;
}): { readonly title: string; readonly subtitle: string } {
  const shop = input.shopName?.trim() || null;
  const org = input.organizationName?.trim() || null;
  return {
    title: shop ?? org ?? 'MirrorFit',
    subtitle: org && shop && org !== shop ? org : 'MirrorFit',
  };
}

export function roleMayManageCatalog(role: StaffRole): boolean {
  return staffRoleRank(role) >= 2;
}

export function roleMayManageDevices(role: StaffRole): boolean {
  return staffRoleRank(role) >= 3;
}

export const CATALOG_CACHE_STORAGE_KEY = 'mirrorfit.catalog.v1';

export interface CatalogCacheEnvelope {
  readonly savedAt: number;
  readonly items: readonly unknown[];
}

const FORBIDDEN_CACHE_KEY = /token|secret|path|url|authorization/i;

/** Drops anything that could be a credential before a catalog is stored on the phone. */
export function sanitizeCatalogCache(items: readonly unknown[]): unknown[] {
  return items.map((item) => {
    if (!item || typeof item !== 'object') return item;
    const next: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(item)) {
      if (FORBIDDEN_CACHE_KEY.test(key)) continue;
      next[key] = value;
    }
    return next;
  });
}

export function cacheIsFresh(
  savedAt: number,
  now: number,
  maxAgeMs = 12 * 60 * 60 * 1000,
): boolean {
  return (
    Number.isFinite(savedAt) && Number.isFinite(now) && now >= savedAt && now - savedAt <= maxAgeMs
  );
}

export interface RetailSelection {
  readonly sessionId: string;
  readonly category: string | null;
  readonly color: string | null;
  readonly size: string | null;
  readonly garmentId: string | null;
}

export interface RetailRollup {
  readonly selectionRate: number | null;
  readonly colors: readonly { readonly label: string; readonly count: number }[];
  readonly sizes: readonly { readonly label: string; readonly count: number }[];
  readonly mostTried: readonly { readonly label: string; readonly count: number }[];
}

function bump(map: Map<string, number>, label: string | null): void {
  if (!label?.trim()) return;
  const key = label.trim();
  map.set(key, (map.get(key) ?? 0) + 1);
}

function ranked(map: Map<string, number>): { label: string; count: number }[] {
  return [...map.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** Counts only fields that were actually stored. Missing color or size stays absent. */
export function rollupSelections(
  sessionCount: number,
  selections: readonly RetailSelection[],
): RetailRollup {
  const colors = new Map<string, number>();
  const sizes = new Map<string, number>();
  const garments = new Map<string, number>();
  const sessions = new Set<string>();
  for (const row of selections) {
    sessions.add(row.sessionId);
    bump(colors, row.color);
    bump(sizes, row.size);
    bump(garments, row.garmentId);
  }
  return {
    selectionRate:
      sessionCount > 0 ? Math.round((sessions.size / sessionCount) * 1000) / 1000 : null,
    colors: ranked(colors),
    sizes: ranked(sizes),
    mostTried: ranked(garments).slice(0, 8),
  };
}
