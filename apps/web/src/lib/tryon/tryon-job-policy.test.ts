import { describe, expect, it } from 'vitest';

import { validateStillJpeg } from '@mirrorfit/tryon-core';

import {
  claimAllowed,
  completionAllowed,
  deviceMayStartTryOn,
  failureNeedsCode,
  photorealResultVisible,
  resultMatchesSelection,
  staleCompletionReason,
  transitionAllowed,
  variantBelongsToDeviceShop,
} from './tryon-job-policy';

const device = { organizationId: 'org', shopId: 'shop', displayId: 'display' };

describe('try-on job authorization', () => {
  it('allows only the display that owns an ACTIVE session', () => {
    expect(
      deviceMayStartTryOn(device, {
        ...device,
        sessionId: 's',
        status: 'ACTIVE',
      }),
    ).toBe(true);
    expect(
      deviceMayStartTryOn(device, {
        ...device,
        displayId: 'other',
        sessionId: 's',
        status: 'ACTIVE',
      }),
    ).toBe(false);
    expect(
      deviceMayStartTryOn(device, {
        ...device,
        sessionId: 's',
        status: 'PAIRED',
      }),
    ).toBe(false);
    expect(
      deviceMayStartTryOn(device, {
        ...device,
        organizationId: 'other-org',
        sessionId: 's',
        status: 'ACTIVE',
      }),
    ).toBe(false);
  });

  it('requires the variant to belong to the device shop', () => {
    expect(
      variantBelongsToDeviceShop(
        {
          garmentId: 'g',
          variantId: 'v',
          organizationId: 'org',
          shopId: 'shop',
          active: true,
        },
        device,
        'g',
        'v',
      ),
    ).toBe(true);
    expect(
      variantBelongsToDeviceShop(
        {
          garmentId: 'g',
          variantId: 'v',
          organizationId: 'org',
          shopId: 'other',
          active: true,
        },
        device,
        'g',
        'v',
      ),
    ).toBe(false);
  });
});

describe('try-on job transitions', () => {
  it('walks QUEUED to RUNNING to SUCCEEDED or FAILED and rejects stale completion', () => {
    expect(claimAllowed('QUEUED')).toBe(true);
    expect(claimAllowed('RUNNING')).toBe(false);
    expect(transitionAllowed('QUEUED', 'RUNNING')).toBe(true);
    expect(transitionAllowed('RUNNING', 'SUCCEEDED')).toBe(true);
    expect(transitionAllowed('RUNNING', 'FAILED')).toBe(true);
    expect(transitionAllowed('QUEUED', 'CANCELLED')).toBe(true);
    expect(completionAllowed('RUNNING')).toBe(true);
    expect(completionAllowed('CANCELLED')).toBe(false);
    expect(transitionAllowed('CANCELLED', 'SUCCEEDED')).toBe(false);
    expect(transitionAllowed('SUCCEEDED', 'SUCCEEDED')).toBe(false);
    expect(failureNeedsCode('FAILED', '')).toBe(false);
    expect(failureNeedsCode('FAILED', 'VTON_NOT_CONNECTED')).toBe(true);
    expect(staleCompletionReason({ sessionStatus: 'ENDED', newerSelectionExists: false })).toBe(
      'SESSION_ENDED',
    );
    expect(staleCompletionReason({ sessionStatus: 'ACTIVE', newerSelectionExists: true })).toBe(
      'STALE_SELECTION',
    );
    expect(
      staleCompletionReason({ sessionStatus: 'ACTIVE', newerSelectionExists: false }),
    ).toBeNull();
  });

  it('does not let an older garment result count for a newer selection', () => {
    expect(
      resultMatchesSelection(
        { garmentId: 'g1', variantId: 'v1' },
        { garmentId: 'g1', variantId: 'v1' },
      ),
    ).toBe(true);
    expect(
      resultMatchesSelection(
        { garmentId: 'g1', variantId: 'v1' },
        { garmentId: 'g2', variantId: 'v2' },
      ),
    ).toBe(false);
  });

  it('rejects a non-jpeg still before a job row exists', () => {
    const bytes = new Uint8Array(64);
    expect(validateStillJpeg(bytes).ok).toBe(false);
  });
});

describe('photoreal layer fallback', () => {
  const visible = {
    outputUrl: 'https://example.test/signed',
    resultGarmentId: 'g1',
    resultVariantId: 'v1',
    selectedGarmentId: 'g1',
    selectedVariantId: 'v1',
    personPresent: true,
  };

  it('shows a signed result only for the current garment while a person is present', () => {
    expect(photorealResultVisible(visible)).toBe(true);
  });

  it('keeps the 2D overlay on failure, timeout, a missing person, and a stale job', () => {
    expect(photorealResultVisible({ ...visible, outputUrl: null })).toBe(false);
    expect(photorealResultVisible({ ...visible, personPresent: false })).toBe(false);
    expect(photorealResultVisible({ ...visible, selectedGarmentId: 'g2' })).toBe(false);
    expect(photorealResultVisible({ ...visible, resultVariantId: 'older' })).toBe(false);
  });
});
