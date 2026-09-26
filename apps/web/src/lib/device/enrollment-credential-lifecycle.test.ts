import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  activeCredentialCount,
  claimDeviceEnrollmentCode,
  credentialAcceptedByHash,
  type EnrollmentCredentialStore,
} from './enrollment-credential-lifecycle';

const NOW = '2026-09-26T08:00:00.000Z';
const ORG_A = 'org-a';
const ORG_B = 'org-b';
const SHOP_A = 'shop-a';
const SHOP_B = 'shop-b';
const DISPLAY_A = 'display-a';
const DISPLAY_B = 'display-b';

function emptyStore(displays: string[] = [DISPLAY_A, DISPLAY_B]): EnrollmentCredentialStore {
  return {
    credentials: [],
    codes: [],
    displays: new Set(displays),
  };
}

function addOutstandingCode(
  store: EnrollmentCredentialStore,
  input: {
    id: string;
    organizationId: string;
    shopId: string;
    displayId: string;
    codeHash: string;
  },
): void {
  store.codes.push({
    ...input,
    claimedAt: null,
    revokedAt: null,
    expiresAt: '2026-09-26T09:00:00.000Z',
  });
}

describe('enrollment credential lifecycle (re-enroll revoke)', () => {
  it('first enrollment creates exactly one active credential', () => {
    const store = emptyStore([DISPLAY_A]);
    addOutstandingCode(store, {
      id: 'code-1',
      organizationId: ORG_A,
      shopId: SHOP_A,
      displayId: DISPLAY_A,
      codeHash: 'hash-code-1',
    });

    const result = claimDeviceEnrollmentCode(store, {
      codeHash: 'hash-code-1',
      secretHash: 'hash-secret-new',
      credentialId: 'cred-1',
      nowIso: NOW,
    });

    expect(result).toEqual({ ok: true, credentialId: 'cred-1' });
    expect(activeCredentialCount(store, DISPLAY_A)).toBe(1);
    expect(credentialAcceptedByHash(store, 'hash-secret-new')).toBe(true);
  });

  it('re-enrollment revokes the old credential and accepts only the new one', () => {
    const store = emptyStore([DISPLAY_A]);
    store.credentials.push({
      id: 'cred-old',
      organizationId: ORG_A,
      shopId: SHOP_A,
      displayId: DISPLAY_A,
      secretHash: 'hash-secret-old',
      revokedAt: null,
    });
    addOutstandingCode(store, {
      id: 'code-2',
      organizationId: ORG_A,
      shopId: SHOP_A,
      displayId: DISPLAY_A,
      codeHash: 'hash-code-2',
    });

    const result = claimDeviceEnrollmentCode(store, {
      codeHash: 'hash-code-2',
      secretHash: 'hash-secret-new',
      credentialId: 'cred-new',
      nowIso: NOW,
    });

    expect(result).toEqual({ ok: true, credentialId: 'cred-new' });
    expect(credentialAcceptedByHash(store, 'hash-secret-old')).toBe(false);
    expect(credentialAcceptedByHash(store, 'hash-secret-new')).toBe(true);
    expect(activeCredentialCount(store, DISPLAY_A)).toBe(1);
    expect(store.credentials.find((c) => c.id === 'cred-old')?.revokedAt).toBe(NOW);
  });

  it('failed enrollment (invalid code) does not revoke the currently working credential', () => {
    const store = emptyStore([DISPLAY_A]);
    store.credentials.push({
      id: 'cred-working',
      organizationId: ORG_A,
      shopId: SHOP_A,
      displayId: DISPLAY_A,
      secretHash: 'hash-secret-working',
      revokedAt: null,
    });
    addOutstandingCode(store, {
      id: 'code-bad',
      organizationId: ORG_A,
      shopId: SHOP_A,
      displayId: DISPLAY_A,
      codeHash: 'hash-code-expired',
    });
    const code = store.codes[0];
    if (!code) throw new Error('expected code');
    code.expiresAt = '2026-09-26T07:00:00.000Z'; // already expired

    const result = claimDeviceEnrollmentCode(store, {
      codeHash: 'hash-code-expired',
      secretHash: 'hash-secret-attempt',
      credentialId: 'cred-attempt',
      nowIso: NOW,
    });

    expect(result).toEqual({ ok: false, reason: 'invalid_code' });
    expect(credentialAcceptedByHash(store, 'hash-secret-working')).toBe(true);
    expect(activeCredentialCount(store, DISPLAY_A)).toBe(1);
    expect(store.credentials.some((c) => c.id === 'cred-attempt')).toBe(false);
  });

  it('failed claim gate rolls back revoke so the old credential stays usable', () => {
    const store = emptyStore([DISPLAY_A]);
    store.forceClaimGateFailure = true;
    store.credentials.push({
      id: 'cred-working',
      organizationId: ORG_A,
      shopId: SHOP_A,
      displayId: DISPLAY_A,
      secretHash: 'hash-secret-working',
      revokedAt: null,
    });
    addOutstandingCode(store, {
      id: 'code-race',
      organizationId: ORG_A,
      shopId: SHOP_A,
      displayId: DISPLAY_A,
      codeHash: 'hash-code-race',
    });

    const result = claimDeviceEnrollmentCode(store, {
      codeHash: 'hash-code-race',
      secretHash: 'hash-secret-new',
      credentialId: 'cred-new',
      nowIso: NOW,
    });

    expect(result).toEqual({ ok: false, reason: 'claim_race' });
    expect(credentialAcceptedByHash(store, 'hash-secret-working')).toBe(true);
    expect(credentialAcceptedByHash(store, 'hash-secret-new')).toBe(false);
    expect(activeCredentialCount(store, DISPLAY_A)).toBe(1);
    expect(store.codes[0]?.claimedAt).toBeNull();
  });

  it('replay of an already-claimed code leaves the active credential alone', () => {
    const store = emptyStore([DISPLAY_A]);
    addOutstandingCode(store, {
      id: 'code-1',
      organizationId: ORG_A,
      shopId: SHOP_A,
      displayId: DISPLAY_A,
      codeHash: 'hash-code-1',
    });

    const first = claimDeviceEnrollmentCode(store, {
      codeHash: 'hash-code-1',
      secretHash: 'hash-secret-first',
      credentialId: 'cred-first',
      nowIso: NOW,
    });
    expect(first.ok).toBe(true);

    const second = claimDeviceEnrollmentCode(store, {
      codeHash: 'hash-code-1',
      secretHash: 'hash-secret-second',
      credentialId: 'cred-second',
      nowIso: NOW,
    });
    expect(second).toEqual({ ok: false, reason: 'invalid_code' });
    expect(credentialAcceptedByHash(store, 'hash-secret-first')).toBe(true);
    expect(credentialAcceptedByHash(store, 'hash-secret-second')).toBe(false);
    expect(activeCredentialCount(store, DISPLAY_A)).toBe(1);
  });

  it('does not revoke credentials belonging to another display', () => {
    const store = emptyStore([DISPLAY_A, DISPLAY_B]);
    store.credentials.push({
      id: 'cred-b',
      organizationId: ORG_A,
      shopId: SHOP_A,
      displayId: DISPLAY_B,
      secretHash: 'hash-secret-b',
      revokedAt: null,
    });
    addOutstandingCode(store, {
      id: 'code-a',
      organizationId: ORG_A,
      shopId: SHOP_A,
      displayId: DISPLAY_A,
      codeHash: 'hash-code-a',
    });

    const result = claimDeviceEnrollmentCode(store, {
      codeHash: 'hash-code-a',
      secretHash: 'hash-secret-a',
      credentialId: 'cred-a',
      nowIso: NOW,
    });

    expect(result.ok).toBe(true);
    expect(credentialAcceptedByHash(store, 'hash-secret-b')).toBe(true);
    expect(activeCredentialCount(store, DISPLAY_B)).toBe(1);
  });

  it('does not revoke credentials belonging to another organization', () => {
    const store = emptyStore([DISPLAY_A]);
    // Same display id should not happen across orgs in production (PK), but
    // the revoke predicate still scopes by organization_id for defense.
    store.credentials.push({
      id: 'cred-other-org',
      organizationId: ORG_B,
      shopId: SHOP_B,
      displayId: DISPLAY_A,
      secretHash: 'hash-secret-other-org',
      revokedAt: null,
    });
    addOutstandingCode(store, {
      id: 'code-a',
      organizationId: ORG_A,
      shopId: SHOP_A,
      displayId: DISPLAY_A,
      codeHash: 'hash-code-a',
    });

    const result = claimDeviceEnrollmentCode(store, {
      codeHash: 'hash-code-a',
      secretHash: 'hash-secret-a',
      credentialId: 'cred-a',
      nowIso: NOW,
    });

    expect(result.ok).toBe(true);
    expect(credentialAcceptedByHash(store, 'hash-secret-other-org')).toBe(true);
    expect(credentialAcceptedByHash(store, 'hash-secret-a')).toBe(true);
  });
});

describe('re-enrollment migration contract', () => {
  it('revokes prior active credentials before insert inside claim_device_enrollment_code', () => {
    const migration = readFileSync(
      resolve(
        import.meta.dirname,
        '../../../../../supabase/migrations/20260926080000_revoke_prior_device_credentials_on_reenroll.sql',
      ),
      'utf8',
    );

    expect(migration).toContain('create or replace function public.claim_device_enrollment_code');
    expect(migration).toContain('for update');
    expect(migration).toMatch(
      /update public\.device_credentials c[\s\S]*revoked_at = now\(\)[\s\S]*revoked_at is null/,
    );
    expect(migration).toContain('and c.organization_id = v_code.organization_id');
    expect(migration.indexOf('set revoked_at = now()')).toBeLessThan(
      migration.lastIndexOf('insert into public.device_credentials'),
    );
    expect(migration).toContain('device_credentials_one_active_per_display_idx');
    expect(migration).not.toMatch(/device_secret|plaintext/i);
    expect(migration).toContain('grant execute on function');
    expect(migration).toContain('to service_role');
  });
});
