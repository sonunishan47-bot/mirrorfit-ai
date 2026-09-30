import { describe, expect, it, vi } from 'vitest';

import {
  buildProductShareText,
  buildWhatsAppShareUrl,
  encodeWhatsAppTextQuery,
  publicItemRef,
  sanitizeShareField,
  shareProductLook,
  whatsAppTextParamIsFullyEncoded,
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

const SPECIAL: ShareableProduct = {
  name: 'Tee & Co. 50% off — "Navy"',
  category: 'Tops / Layers',
  colorName: 'Blue#1',
  brand: 'Lab+Partners',
  size: 'M/L',
  priceMinor: 4599,
  currencyCode: 'USD',
  garmentId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  variantId: '11111111-2222-4333-8444-555555555555',
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

  it('strips control characters from share fields', () => {
    expect(sanitizeShareField('Hello\u0000World\n')).toBe('HelloWorld');
  });

  it('builds a wa.me deep link', () => {
    const url = buildWhatsAppShareUrl(PRODUCT);
    expect(url.startsWith('https://wa.me/?text=')).toBe(true);
    expect(url).toContain(encodeURIComponent('Shop tee'));
    expect(whatsAppTextParamIsFullyEncoded(url)).toBe(true);
  });

  it('targets a store number when provided', () => {
    const url = buildWhatsAppShareUrl(PRODUCT, '+1 (555) 010-9999');
    expect(url.startsWith('https://wa.me/15550109999?text=')).toBe(true);
    expect(whatsAppTextParamIsFullyEncoded(url)).toBe(true);
  });

  it('encodes spaces, newlines, and reserved characters in the text query', () => {
    const url = buildWhatsAppShareUrl(SPECIAL);
    const encoded = url.slice(url.indexOf('text=') + 'text='.length);
    expect(encoded).toBe(encodeWhatsAppTextQuery(buildProductShareText(SPECIAL)));
    expect(encoded).not.toContain(' ');
    expect(encoded).not.toContain('\n');
    expect(encoded).toContain('%26'); // &
    expect(encoded).toContain('%22'); // "
    expect(encoded).toContain('%23'); // #
    expect(encoded).toContain('%25'); // %
    expect(encoded).toContain('%0A'); // newline between lines
    expect(decodeURIComponent(encoded)).toContain('Tee & Co. 50% off');
    expect(whatsAppTextParamIsFullyEncoded(url)).toBe(true);
  });

  it('encodeWhatsAppTextQuery matches encodeURIComponent', () => {
    const sample = 'A B\nC&D=E#F%G';
    expect(encodeWhatsAppTextQuery(sample)).toBe(encodeURIComponent(sample));
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
        copyText: () => Promise.resolve(true),
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
        copyText: () => Promise.resolve(false),
      },
    });
    expect(result.ok).toBe(false);
    expect(result.channel).toBe('none');
    expect(result.error).toBeTruthy();
  });
});
