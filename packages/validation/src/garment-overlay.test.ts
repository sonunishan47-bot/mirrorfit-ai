import { describe, expect, it } from 'vitest';

import { garmentOverlayQuerySchema, garmentOverlayResponseSchema } from './garment-overlay';

const HASH = 'a'.repeat(64);
const GARMENT = '11111111-1111-4111-8111-111111111111';
const VARIANT = '22222222-2222-4222-8222-222222222222';

describe('garment overlay validation', () => {
  it('accepts a device overlay response with png metadata', () => {
    const parsed = garmentOverlayResponseSchema.safeParse({
      overlay_url:
        'https://example.supabase.co/storage/v1/object/sign/garment-assets/x.png?token=abc',
      expires_in: 120,
      width: 800,
      height: 1200,
      mime_type: 'image/png',
      version: 2,
      content_hash: HASH,
      garment_id: GARMENT,
      variant_id: VARIANT,
      anchor: { x: 0.5, y: 0.22 },
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects jpeg overlays and invalid anchors', () => {
    expect(
      garmentOverlayResponseSchema.safeParse({
        overlay_url: 'https://example.com/a.jpg',
        expires_in: 120,
        width: 800,
        height: 1200,
        mime_type: 'image/jpeg',
        version: 1,
        content_hash: HASH,
        garment_id: GARMENT,
        variant_id: null,
        anchor: null,
      }).success,
    ).toBe(false);
    expect(
      garmentOverlayResponseSchema.safeParse({
        overlay_url: 'https://example.com/a.png',
        expires_in: 120,
        width: 800,
        height: 1200,
        mime_type: 'image/png',
        version: 1,
        content_hash: HASH,
        garment_id: GARMENT,
        variant_id: null,
        anchor: { x: 1.5, y: 0.2 },
      }).success,
    ).toBe(false);
  });

  it('requires garment and variant ids on the query', () => {
    expect(
      garmentOverlayQuerySchema.safeParse({
        garment_id: GARMENT,
        variant_id: VARIANT,
      }).success,
    ).toBe(true);
    expect(
      garmentOverlayQuerySchema.safeParse({
        garment_id: 'not-a-uuid',
        variant_id: VARIANT,
      }).success,
    ).toBe(false);
  });
});
