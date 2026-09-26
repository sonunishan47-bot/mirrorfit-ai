import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { classifyDisplayHealth, summarizeKioskFleet } from '../ops/kiosk-health';

import {
  restoreDisplayOnlineAfterEnroll,
  revokeCredentialInMemory,
  type RevocableCredential,
  type RevocableDisplay,
} from './revoke-display-status';

const NOW = '2026-09-26T12:00:00.000Z';
const ORG_A = 'org-a';
const ORG_B = 'org-b';
const DISPLAY_A = 'display-a';
const DISPLAY_B = 'display-b';
const CRED_A = 'cred-a';
const CRED_B = 'cred-b';

describe('revoke credential → display REVOKED', () => {
  it('sets the owning display to REVOKED on successful revoke', () => {
    const credentials: RevocableCredential[] = [
      { id: CRED_A, displayId: DISPLAY_A, organizationId: ORG_A, revokedAt: null },
    ];
    const displays: RevocableDisplay[] = [
      { id: DISPLAY_A, organizationId: ORG_A, status: 'ONLINE' },
    ];

    const result = revokeCredentialInMemory(credentials, displays, {
      credentialId: CRED_A,
      callerOrganizationId: ORG_A,
      nowIso: NOW,
    });

    expect(result).toEqual({ ok: true, displayId: DISPLAY_A });
    expect(credentials[0]?.revokedAt).toBe(NOW);
    expect(displays[0]?.status).toBe('REVOKED');
  });

  it('leaves display status unchanged when revoke fails', () => {
    const credentials: RevocableCredential[] = [
      { id: CRED_A, displayId: DISPLAY_A, organizationId: ORG_A, revokedAt: NOW },
    ];
    const displays: RevocableDisplay[] = [
      { id: DISPLAY_A, organizationId: ORG_A, status: 'ONLINE' },
    ];

    expect(
      revokeCredentialInMemory(credentials, displays, {
        credentialId: CRED_A,
        callerOrganizationId: ORG_A,
        nowIso: '2026-09-26T13:00:00.000Z',
      }),
    ).toEqual({ ok: false, reason: 'already_revoked' });
    expect(displays[0]?.status).toBe('ONLINE');

    expect(
      revokeCredentialInMemory(credentials, displays, {
        credentialId: 'missing',
        callerOrganizationId: ORG_A,
        nowIso: NOW,
      }),
    ).toEqual({ ok: false, reason: 'not_found' });
    expect(displays[0]?.status).toBe('ONLINE');
  });

  it('rejects cross-tenant revoke without mutating either side', () => {
    const credentials: RevocableCredential[] = [
      { id: CRED_A, displayId: DISPLAY_A, organizationId: ORG_A, revokedAt: null },
    ];
    const displays: RevocableDisplay[] = [
      { id: DISPLAY_A, organizationId: ORG_A, status: 'ONLINE' },
    ];

    expect(
      revokeCredentialInMemory(credentials, displays, {
        credentialId: CRED_A,
        callerOrganizationId: ORG_B,
        nowIso: NOW,
      }),
    ).toEqual({ ok: false, reason: 'cross_tenant' });
    expect(credentials[0]?.revokedAt).toBeNull();
    expect(displays[0]?.status).toBe('ONLINE');
  });

  it('does not affect another display in the same org', () => {
    const credentials: RevocableCredential[] = [
      { id: CRED_A, displayId: DISPLAY_A, organizationId: ORG_A, revokedAt: null },
      { id: CRED_B, displayId: DISPLAY_B, organizationId: ORG_A, revokedAt: null },
    ];
    const displays: RevocableDisplay[] = [
      { id: DISPLAY_A, organizationId: ORG_A, status: 'ONLINE' },
      { id: DISPLAY_B, organizationId: ORG_A, status: 'ONLINE' },
    ];

    revokeCredentialInMemory(credentials, displays, {
      credentialId: CRED_A,
      callerOrganizationId: ORG_A,
      nowIso: NOW,
    });

    expect(displays[0]?.status).toBe('REVOKED');
    expect(displays[1]?.status).toBe('ONLINE');
    expect(credentials[1]?.revokedAt).toBeNull();
  });

  it('restores ONLINE on successful re-enrollment after revoke', () => {
    const credentials: RevocableCredential[] = [
      { id: CRED_A, displayId: DISPLAY_A, organizationId: ORG_A, revokedAt: null },
    ];
    const displays: RevocableDisplay[] = [
      { id: DISPLAY_A, organizationId: ORG_A, status: 'ONLINE' },
    ];

    revokeCredentialInMemory(credentials, displays, {
      credentialId: CRED_A,
      callerOrganizationId: ORG_A,
      nowIso: NOW,
    });
    expect(displays[0]?.status).toBe('REVOKED');

    restoreDisplayOnlineAfterEnroll(displays, DISPLAY_A, ORG_A);
    expect(displays[0]?.status).toBe('ONLINE');
  });

  it('projects REVOKED into ops fleet health', () => {
    const nowMs = Date.parse(NOW);
    const health = classifyDisplayHealth(
      {
        id: DISPLAY_A,
        name: 'Mirror A',
        shop_id: 'shop-a',
        status: 'REVOKED',
        last_heartbeat_at: '2026-09-26T11:59:00.000Z',
        camera_ok: true,
        app_version: '1.0.0',
      },
      nowMs,
    );
    expect(health.health).toBe('revoked');
    expect(summarizeKioskFleet([health]).revoked).toBe(1);
  });
});

describe('revoke → display REVOKED migration contract', () => {
  const migration = readFileSync(
    resolve(
      import.meta.dirname,
      '../../../../../supabase/migrations/20260926093000_revoke_credential_sets_display_revoked.sql',
    ),
    'utf8',
  );

  it('installs a security-definer trigger that sets displays.status to REVOKED', () => {
    expect(migration).toContain('on_device_credential_revoked');
    expect(migration).toContain('device_credentials_after_revoke');
    expect(migration).toContain("status = 'REVOKED'::public.device_status");
    expect(migration).toContain('security definer');
    expect(migration).toContain('OLD.revoked_at is null');
    expect(migration).toContain('NEW.revoked_at is not null');
  });
});
