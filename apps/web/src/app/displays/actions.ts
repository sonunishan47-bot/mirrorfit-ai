'use server';

import { revalidatePath } from 'next/cache';

import { ADMIN_ROLE_RANK, formatEnrollmentCode } from '@mirrorfit/types';
import { displayCreateSchema, issuedEnrollmentCodeSchema, uuidSchema } from '@mirrorfit/validation';

import { recordStaffAction } from '@/lib/audit';
import { requireStaffRank } from '@/lib/auth/staff';
import { generateEnrollmentCode, sha256Hex } from '@/lib/crypto/secrets';
import { createSupabaseAdminClient } from '@/lib/supabase/admin-client';
import { createSupabaseServerClient } from '@/lib/supabase/server-client';

/** How long a technician has to type the code before it stops working. */
const ENROLLMENT_CODE_TTL_SECONDS = 600;

export interface ActionResult {
  readonly ok: boolean;
  readonly message?: string;
  /**
   * Present only on a successful code issue, and only on the response to the
   * request that created it. Never read back from anywhere.
   */
  readonly enrollmentCode?: string;
  readonly expiresAt?: string;
}

/**
 * Confirms a shop is one the caller may act on.
 *
 * Reads through the RLS-scoped client on purpose. The policy already limits
 * visible shops to the caller's organization and shop scope, so a row coming
 * back is itself the authorisation. This is how a posted `shop_id` becomes
 * trustworthy: not by believing it, but by failing to find it.
 */
async function assertShopInScope(shopId: string): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.from('shops').select('id').eq('id', shopId).maybeSingle();
  return data !== null;
}

export async function createDisplay(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const staff = await requireStaffRank(ADMIN_ROLE_RANK);

  const parsed = displayCreateSchema.safeParse({
    shop_id: formData.get('shop_id'),
    name: formData.get('name'),
    slug: formData.get('slug'),
  });

  if (!parsed.success) {
    return { ok: false, message: 'Check the name, slug and shop.' };
  }

  if (!(await assertShopInScope(parsed.data.shop_id))) {
    return { ok: false, message: 'That shop is not available to you.' };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('displays')
    .insert({
      // Tenancy comes from the session, not the form. The form only chooses
      // among shops the session already proved access to.
      organization_id: staff.organizationId,
      shop_id: parsed.data.shop_id,
      name: parsed.data.name,
      slug: parsed.data.slug,
    })
    .select('id')
    .single();

  if (error || !data) {
    return {
      ok: false,
      message: 'Could not create the display. The slug may already be used in this shop.',
    };
  }

  await recordStaffAction({
    organizationId: staff.organizationId,
    staffId: staff.staffId,
    action: 'DISPLAY_CREATED',
    entityType: 'display',
    entityId: data.id,
    metadata: { slug: parsed.data.slug },
  });

  revalidatePath('/displays');
  return { ok: true, message: `Created ${parsed.data.name}.` };
}

/**
 * Mints an enrollment code for a display.
 *
 * The plaintext is returned in this action's result and never stored, so it
 * reaches the operator's screen in the response body. It deliberately does
 * not travel as a redirect query parameter, which would put a live
 * credential into browser history, the referrer header and every access log
 * between here and them.
 */
export async function issueEnrollmentCode(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const staff = await requireStaffRank(ADMIN_ROLE_RANK);

  const displayId = uuidSchema.safeParse(formData.get('display_id'));
  if (!displayId.success) {
    return { ok: false, message: 'Unknown display.' };
  }

  // Same trick as the shop check: if RLS does not show it, it is not theirs.
  const scoped = await createSupabaseServerClient();
  const { data: display } = await scoped
    .from('displays')
    .select('id, name')
    .eq('id', displayId.data)
    .maybeSingle();

  if (!display) {
    return { ok: false, message: 'Unknown display.' };
  }

  const code = generateEnrollmentCode();

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.rpc('issue_device_enrollment_code', {
    p_display_id: display.id,
    p_staff_id: staff.staffId,
    p_code_hash: sha256Hex(code),
    p_ttl_seconds: ENROLLMENT_CODE_TTL_SECONDS,
  });

  if (error || !data) {
    return { ok: false, message: 'Could not issue a code.' };
  }

  const issued = issuedEnrollmentCodeSchema.safeParse(data);
  if (!issued.success) {
    return { ok: false, message: 'Could not issue a code.' };
  }

  await recordStaffAction({
    organizationId: staff.organizationId,
    staffId: staff.staffId,
    action: 'ENROLLMENT_CODE_ISSUED',
    entityType: 'device_enrollment_code',
    entityId: issued.data.code_id,
    // The row, not the code. Writing the code here would defeat hashing it.
    metadata: { display_id: display.id },
  });

  revalidatePath('/displays');
  return {
    ok: true,
    enrollmentCode: formatEnrollmentCode(code),
    expiresAt: issued.data.expires_at,
  };
}

/**
 * Revokes a device credential.
 *
 * Goes through the RLS client rather than the admin client. The policy
 * already allows an admin to update credentials in their own organization,
 * and the column grant limits them to `label` and `revoked_at`, so the
 * database enforces both who and what. Reaching for the admin client here
 * would replace two enforced constraints with a comment.
 *
 * Setting `revoked_at` fires `device_credentials_after_revoke`, which marks
 * the owning display `REVOKED` in the same transaction. If this update
 * matches no row, the display status is left unchanged.
 */
export async function revokeCredential(
  _previous: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const staff = await requireStaffRank(ADMIN_ROLE_RANK);

  const credentialId = uuidSchema.safeParse(formData.get('credential_id'));
  if (!credentialId.success) {
    return { ok: false, message: 'Unknown credential.' };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from('device_credentials')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', credentialId.data)
    .is('revoked_at', null)
    .select('id, display_id')
    .maybeSingle();

  if (error || !data) {
    return { ok: false, message: 'Could not revoke that credential.' };
  }

  await recordStaffAction({
    organizationId: staff.organizationId,
    staffId: staff.staffId,
    action: 'DEVICE_CREDENTIAL_REVOKED',
    entityType: 'device_credential',
    entityId: data.id,
    metadata: { display_id: data.display_id },
  });

  revalidatePath('/displays');
  revalidatePath('/ops');
  return { ok: true, message: 'Credential revoked. That mirror must be re-enrolled.' };
}
