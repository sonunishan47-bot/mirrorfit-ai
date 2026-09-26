/**
 * In-memory model of the credential steps inside
 * `public.claim_device_enrollment_code` after the re-enrollment fix.
 *
 * The production invariant is enforced in Postgres (same transaction as the
 * enrollment-code claim). This module exists so Vitest can regress the
 * lifecycle without a live database: revoke-before-mint, rollback on failed
 * claim, and cross-display / cross-org isolation.
 *
 * It never handles plaintext secrets — only opaque hash strings, matching
 * the database column contract.
 */

export interface EnrollmentCredentialRow {
  readonly id: string;
  readonly organizationId: string;
  readonly shopId: string;
  readonly displayId: string;
  readonly secretHash: string;
  revokedAt: string | null;
}

export interface EnrollmentCodeRow {
  readonly id: string;
  readonly organizationId: string;
  readonly shopId: string;
  readonly displayId: string;
  readonly codeHash: string;
  claimedAt: string | null;
  revokedAt: string | null;
  expiresAt: string;
}

export type ClaimEnrollmentFailure =
  | 'invalid_code'
  | 'display_missing'
  | 'claim_race';

export type ClaimEnrollmentResult =
  | { readonly ok: true; readonly credentialId: string }
  | { readonly ok: false; readonly reason: ClaimEnrollmentFailure };

export interface EnrollmentCredentialStore {
  credentials: EnrollmentCredentialRow[];
  codes: EnrollmentCodeRow[];
  displays: ReadonlySet<string>;
  /**
   * Test-only: after revoke+insert, pretend the conditional code UPDATE
   * matched zero rows so the transaction must roll back.
   */
  forceClaimGateFailure?: boolean;
}

function activeForDisplay(
  store: EnrollmentCredentialStore,
  displayId: string,
): EnrollmentCredentialRow[] {
  return store.credentials.filter((row) => row.displayId === displayId && row.revokedAt === null);
}

/**
 * Mirrors the transactional claim path:
 * validate code → lock display → revoke prior active for that display+org →
 * insert → conditional claim. On any failure after mutation, restore snapshot
 * (models Postgres rollback).
 */
export function claimDeviceEnrollmentCode(
  store: EnrollmentCredentialStore,
  input: {
    readonly codeHash: string;
    readonly secretHash: string;
    readonly credentialId: string;
    readonly nowIso: string;
  },
): ClaimEnrollmentResult {
  const snapshot = {
    credentials: store.credentials.map((row) => ({ ...row })),
    codes: store.codes.map((row) => ({ ...row })),
  };

  const rollback = (): void => {
    store.credentials = snapshot.credentials;
    store.codes = snapshot.codes;
  };

  const code = store.codes.find((row) => row.codeHash === input.codeHash);
  if (
    !code ||
    code.claimedAt !== null ||
    code.revokedAt !== null ||
    Date.parse(code.expiresAt) <= Date.parse(input.nowIso)
  ) {
    return { ok: false, reason: 'invalid_code' };
  }

  if (!store.displays.has(code.displayId)) {
    return { ok: false, reason: 'display_missing' };
  }

  // Revoke prior active credentials for this display in the same org only.
  for (const row of store.credentials) {
    if (
      row.displayId === code.displayId &&
      row.organizationId === code.organizationId &&
      row.revokedAt === null
    ) {
      row.revokedAt = input.nowIso;
    }
  }

  store.credentials.push({
    id: input.credentialId,
    organizationId: code.organizationId,
    shopId: code.shopId,
    displayId: code.displayId,
    secretHash: input.secretHash,
    revokedAt: null,
  });

  // Conditional claim gate (single-use). Failure rolls everything back —
  // including the revoke — so a still-working device is not locked out.
  if (store.forceClaimGateFailure || code.claimedAt !== null || code.revokedAt !== null) {
    rollback();
    return { ok: false, reason: 'claim_race' };
  }
  code.claimedAt = input.nowIso;

  return { ok: true, credentialId: input.credentialId };
}

/** Auth acceptance: hash match + not revoked (expires omitted for clarity). */
export function credentialAcceptedByHash(
  store: EnrollmentCredentialStore,
  secretHash: string,
): boolean {
  const row = store.credentials.find((c) => c.secretHash === secretHash);
  return row !== undefined && row.revokedAt === null;
}

export function activeCredentialCount(
  store: EnrollmentCredentialStore,
  displayId: string,
): number {
  return activeForDisplay(store, displayId).length;
}
