import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { isPublicPath } from '@/lib/auth/public-paths';

import { opsQueryAttemptsTenantOverride, resolveOpsShopId } from './ops-shop-scope';

const webRoot = resolve(import.meta.dirname, '../..');

function source(relative: string): string {
  return readFileSync(resolve(webRoot, relative), 'utf8');
}

describe('ops staff route protection', () => {
  it('keeps /ops and /api/ops off the public path allowlist', () => {
    expect(isPublicPath('/ops')).toBe(false);
    expect(isPublicPath('/ops/')).toBe(false);
    expect(isPublicPath('/api/ops/summary')).toBe(false);
    expect(isPublicPath('/api/ops')).toBe(false);
  });

  it('never lets shop-scoped staff be overridden by a query shop_id', () => {
    const staffShop = '11111111-1111-4111-8111-111111111111';
    const other = '22222222-2222-4222-8222-222222222222';
    expect(resolveOpsShopId(staffShop, other)).toBe(staffShop);
    expect(resolveOpsShopId(staffShop, null)).toBe(staffShop);
  });

  it('allows org-wide staff to filter by a valid shop UUID only', () => {
    const shop = '11111111-1111-4111-8111-111111111111';
    expect(resolveOpsShopId(null, shop)).toBe(shop);
    expect(resolveOpsShopId(null, 'not-a-uuid')).toBeNull();
    expect(resolveOpsShopId(null, null)).toBeNull();
  });

  it('flags organization_id smuggling in ops queries', () => {
    expect(opsQueryAttemptsTenantOverride(new URLSearchParams('organization_id=x'))).toBe(true);
    expect(opsQueryAttemptsTenantOverride(new URLSearchParams('shop_id=y'))).toBe(false);
  });

  it('ops summary route resolves tenancy from staff, not client org ids', () => {
    const route = source('app/api/ops/summary/route.ts');
    expect(route).toContain('getStaffContext');
    expect(route).toContain('resolveOpsShopId');
    expect(route).toContain('opsQueryAttemptsTenantOverride');
    expect(route).not.toMatch(/organization_id:\s*url|organizationId\s*=\s*url/);
    expect(route).toMatch(/storage_path|device_secret|pairing_token/);
  });

  it('ops page requires staff before loading snapshots', () => {
    const page = source('app/ops/page.tsx');
    expect(page).toContain('requireStaff');
    expect(page).toContain('loadOpsSnapshot');
    expect(page).not.toMatch(/organization_id.*searchParams|searchParams.*organization_id/);
  });
});
