import 'server-only';

import { redirect } from 'next/navigation';

import { staffRoleRank, type OrganizationId, type ShopId, type StaffRole } from '@mirrorfit/types';
import type { StaffUserId } from '@mirrorfit/types';

import { createSupabaseServerClient } from '@/lib/supabase/server-client';

/**
 * Who the caller is, resolved from the session rather than from the request.
 *
 * This is the only place tenancy enters the application. Nothing downstream
 * should accept an organization, shop or role from a form field, a query
 * parameter or a header; it takes them from here, where they came from the
 * database keyed by an authenticated user id.
 */
export interface StaffContext {
  readonly staffId: StaffUserId;
  readonly organizationId: OrganizationId;
  /** `null` means organization-wide, not "no shop". */
  readonly shopId: ShopId | null;
  readonly role: StaffRole;
  readonly roleRank: number;
  readonly email: string;
  readonly fullName: string | null;
}

/**
 * Resolves the signed-in staff member, or `null`.
 *
 * Uses `getUser()` rather than `getSession()`. `getSession()` reads the
 * cookie and trusts it; `getUser()` verifies the token with the auth server.
 * On a server that is about to make authorisation decisions, the difference
 * matters.
 *
 * A Supabase user with no `staff_users` row, or one that has been
 * deactivated, resolves to `null`. Authentication is not membership.
 */
export async function getStaffContext(): Promise<StaffContext | null> {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const { data, error } = await supabase
    .from('staff_users')
    .select('id, organization_id, shop_id, role, email, full_name, is_active')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  if (error || !data || !data.is_active) {
    return null;
  }

  return {
    staffId: data.id as StaffUserId,
    organizationId: data.organization_id as OrganizationId,
    shopId: (data.shop_id as ShopId | null) ?? null,
    role: data.role,
    roleRank: staffRoleRank(data.role),
    email: data.email,
    fullName: data.full_name,
  };
}

/**
 * The same, but for pages and actions that have no meaning without a caller.
 *
 * Redirects rather than throwing, so an expired session lands on the login
 * screen instead of an error page.
 */
export async function requireStaff(): Promise<StaffContext> {
  const staff = await getStaffContext();
  if (!staff) {
    redirect('/login');
  }
  return staff;
}

/**
 * Asserts a minimum role.
 *
 * This is a usability guard, not the security boundary. Every table these
 * actions touch enforces the same rank in its RLS policy, so a caller who got
 * past this still cannot write anything they should not. Checking here means
 * they get a clear refusal instead of an opaque database error.
 */
export async function requireStaffRank(minimumRank: number): Promise<StaffContext> {
  const staff = await requireStaff();
  if (staff.roleRank < minimumRank) {
    redirect('/displays?denied=1');
  }
  return staff;
}
