import 'server-only';

import { headers } from 'next/headers';

import type { DisplayId, OrganizationId, StaffUserId } from '@mirrorfit/types';

import { createSupabaseAdminClient } from '@/lib/supabase/admin-client';

/**
 * Writes to the audit trail.
 *
 * Uses the admin client because `audit_logs` has no insert policy and no
 * insert grant for any client role. That is the point: an organization owner
 * must be able to read their trail and must not be able to write or erase an
 * entry. Only server code that has already authorised an action appends to
 * it.
 *
 * Metadata is for identifying what happened, never for reproducing it. Do not
 * put a code, a secret, a token or a hash of one in here.
 */

type AuditMetadata = Readonly<Record<string, string | number | boolean | null>>;

interface RequestFingerprint {
  readonly ip_address: string | null;
  readonly user_agent: string | null;
}

async function requestFingerprint(): Promise<RequestFingerprint> {
  const headerList = await headers();

  // The left-most entry is the original client. Everything after it was added
  // by a proxy. Take only the first, and only if it parses as an address the
  // `inet` column will accept.
  const forwarded = headerList.get('x-forwarded-for')?.split(',')[0]?.trim();
  const candidate = forwarded && forwarded.length > 0 ? forwarded : null;

  return {
    ip_address: candidate && /^[0-9a-fA-F.:]+$/.test(candidate) ? candidate : null,
    user_agent: headerList.get('user-agent')?.slice(0, 500) ?? null,
  };
}

interface StaffActionEntry {
  readonly organizationId: OrganizationId;
  readonly staffId: StaffUserId;
  readonly action: string;
  readonly entityType: string;
  readonly entityId?: string | undefined;
  readonly metadata?: AuditMetadata | undefined;
}

/**
 * Records a staff action.
 *
 * Throws if the write fails. A privileged action that cannot be attributed
 * should not be reported as having succeeded, and the caller runs this before
 * returning so the operator sees the failure and can retry.
 */
export async function recordStaffAction(entry: StaffActionEntry): Promise<void> {
  const supabase = createSupabaseAdminClient();
  const fingerprint = await requestFingerprint();

  const { error } = await supabase.from('audit_logs').insert({
    organization_id: entry.organizationId,
    actor_kind: 'STAFF',
    actor_staff_id: entry.staffId,
    action: entry.action,
    entity_type: entry.entityType,
    entity_id: entry.entityId ?? null,
    metadata: entry.metadata ?? {},
    ...fingerprint,
  });

  if (error) {
    throw new Error(`Failed to record audit entry for ${entry.action}`);
  }
}

interface DeviceActionEntry {
  readonly organizationId: OrganizationId;
  readonly displayId: DisplayId;
  readonly action: string;
  readonly entityType: string;
  readonly entityId?: string | undefined;
  readonly metadata?: AuditMetadata | undefined;
}

export async function recordDeviceAction(entry: DeviceActionEntry): Promise<void> {
  const supabase = createSupabaseAdminClient();
  const fingerprint = await requestFingerprint();

  const { error } = await supabase.from('audit_logs').insert({
    organization_id: entry.organizationId,
    actor_kind: 'DEVICE',
    actor_display_id: entry.displayId,
    action: entry.action,
    entity_type: entry.entityType,
    entity_id: entry.entityId ?? null,
    metadata: entry.metadata ?? {},
    ...fingerprint,
  });

  if (error) {
    throw new Error(`Failed to record audit entry for ${entry.action}`);
  }
}
