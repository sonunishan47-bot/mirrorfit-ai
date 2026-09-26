import { describe, expect, it, vi } from 'vitest';

import {
  buildProductShareText,
  buildWhatsAppShareUrl,
  publicItemRef,
  shareProductLook,
  type ShareableProduct,
} from './product-share';

const PRODUCT: ShareableProduct = {
  name: 'Shop tee',
  category: 'Tops',
  colorName: 'Black',
  brand: 'Lab',
  size: 'M',
  priceMinor: 4500,
  currencyCode: 'USD',
  garmentId: '33333333-3333-4333-8333-333333333333',
  variantId: '55555555-5555-4555-8555-555555555555',
};

describe('product share', () => {
  it('builds a public floor reference without secrets', () => {
    expect(publicItemRef(PRODUCT.garmentId)).toBe('33333333');
  });

  it('composes share text with public fields only', () => {
    const text = buildProductShareText(PRODUCT);
    expect(text).toContain('Shop tee');
    expect(text).toContain('Black');
    expect(text).toContain('Item ref: 33333333');
    expect(text).not.toMatch(/storage_path|overlay_url|device_secret|organization_id/);
  });

  it('builds a wa.me deep link', () => {
    const url = buildWhatsAppShareUrl(PRODUCT);
    expect(url.startsWith('https://wa.me/?text=')).toBe(true);
    expect(url).toContain(encodeURIComponent('Shop tee'));
  });

  it('targets a store number when provided', () => {
    const url = buildWhatsAppShareUrl(PRODUCT, '+1 (555) 010-9999');
    expect(url.startsWith('https://wa.me/15550109999?text=')).toBe(true);
  });

  it('opens WhatsApp via the injected port', async () => {
    const openUrl = vi.fn();
    const result = await shareProductLook(PRODUCT, { ports: { openUrl } });
    expect(result.ok).toBe(true);
    expect(result.channel).toBe('whatsapp');
    expect(openUrl).toHaveBeenCalledOnce();
  });

  it('falls back to clipboard when open fails', async () => {
    const result = await shareProductLook(PRODUCT, {
      ports: {
        openUrl: () => {
          throw new Error('blocked');
        },
        copyText: async () => true,
      },
    });
    expect(result.ok).toBe(true);
    expect(result.channel).toBe('clipboard');
  });

  it('returns a soft failure when no channel works', async () => {
    const result = await shareProductLook(PRODUCT, {
      ports: {
        openUrl: () => {
          throw new Error('blocked');
        },
        copyText: async () => false,
      },
    });
    expect(result.ok).toBe(false);
    expect(result.channel).toBe('none');
    expect(result.error).toBeTruthy();
  });
});
