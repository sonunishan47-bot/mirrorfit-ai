/**
 * Pure model of credential revoke → display REVOKED, used for Vitest.
 * Production enforcement is the `device_credentials_after_revoke` trigger.
 */

export type DeviceDisplayStatus = 'ONLINE' | 'OFFLINE' | 'MAINTENANCE' | 'REVOKED';

export interface RevocableCredential {
  readonly id: string;
  readonly displayId: string;
  readonly organizationId: string;
  revokedAt: string | null;
}

export interface RevocableDisplay {
  readonly id: string;
  readonly organizationId: string;
  status: DeviceDisplayStatus;
}

export type RevokeCredentialResult =
  | { readonly ok: true; readonly displayId: string }
  | { readonly ok: false; readonly reason: 'not_found' | 'already_revoked' | 'cross_tenant' };

/**
 * Simulates staff revoke: only an active credential in the caller's org
 * may be revoked; the display flips to REVOKED only on success.
 */
export function revokeCredentialInMemory(
  credentials: RevocableCredential[],
  displays: RevocableDisplay[],
  input: {
    readonly credentialId: string;
    readonly callerOrganizationId: string;
    readonly nowIso: string;
  },
): RevokeCredentialResult {
  const credential = credentials.find((row) => row.id === input.credentialId);
  if (!credential) {
    return { ok: false, reason: 'not_found' };
  }
  if (credential.organizationId !== input.callerOrganizationId) {
    return { ok: false, reason: 'cross_tenant' };
  }
  if (credential.revokedAt !== null) {
    return { ok: false, reason: 'already_revoked' };
  }

  credential.revokedAt = input.nowIso;

  const display = displays.find(
    (row) => row.id === credential.displayId && row.organizationId === credential.organizationId,
  );
  if (display && display.status !== 'REVOKED') {
    display.status = 'REVOKED';
  }

  return { ok: true, displayId: credential.displayId };
}

/** Re-enrollment restores ONLINE after minting a replacement credential. */
export function restoreDisplayOnlineAfterEnroll(
  displays: RevocableDisplay[],
  displayId: string,
  organizationId: string,
): void {
  const display = displays.find(
    (row) => row.id === displayId && row.organizationId === organizationId,
  );
  if (display) display.status = 'ONLINE';
}
