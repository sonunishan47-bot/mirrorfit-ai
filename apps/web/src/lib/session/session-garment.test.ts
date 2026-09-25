import { pairingTokenSchema, selectedGarmentSchema } from '@mirrorfit/validation';
import { describe, expect, it } from 'vitest';

import { sessionCanMutateGarment } from './session-garment-policy';

const GARMENT = '33333333-3333-4333-8333-333333333333';
const VARIANT = '55555555-5555-4555-8555-555555555555';
const OTHER_ORG = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

describe('session garment payload isolation', () => {
  it('accepts a shop-scoped selection and optional category', () => {
    const parsed = selectedGarmentSchema.parse({
      garment_id: GARMENT,
      variant_id: VARIANT,
      category: 'Tops',
      organization_id: OTHER_ORG,
      shop_id: OTHER_ORG,
    });
    expect(parsed).toEqual({
      garment_id: GARMENT,
      variant_id: VARIANT,
      category: 'Tops',
    });
    expect(parsed).not.toHaveProperty('organization_id');
    expect(parsed).not.toHaveProperty('shop_id');
  });

  it('rejects an invalid garment id instead of trusting the phone', () => {
    expect(
      selectedGarmentSchema.safeParse({
        garment_id: 'not-a-uuid',
        variant_id: VARIANT,
      }).success,
    ).toBe(false);
  });

  it('rejects an expired-looking or malformed pairing token', () => {
    expect(pairingTokenSchema.safeParse('short')).toEqual(
      expect.objectContaining({ success: false }),
    );
    expect(pairingTokenSchema.safeParse('revoked'.repeat(10)).success).toBe(false);
  });

  it('allows garment writes only while PAIRED or ACTIVE', () => {
    expect(sessionCanMutateGarment('PAIRED')).toBe(true);
    expect(sessionCanMutateGarment('ACTIVE')).toBe(true);
    expect(sessionCanMutateGarment('WAITING')).toBe(false);
    expect(sessionCanMutateGarment('ENDED')).toBe(false);
    expect(sessionCanMutateGarment('EXPIRED')).toBe(false);
  });
});
