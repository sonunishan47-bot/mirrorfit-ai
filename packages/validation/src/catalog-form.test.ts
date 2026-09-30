import { describe, expect, it } from 'vitest';

import { garmentCreateSchema } from './catalog-form';

const shopId = '11111111-1111-4111-8111-111111111111';

describe('garment create form', () => {
  it('accepts an abaya without a price and lowercases the colour', () => {
    const parsed = garmentCreateSchema.parse({
      shop_id: shopId,
      name: 'Evening abaya',
      sku: '',
      category: 'Abaya',
      color_name: 'Black',
      color_hex: '#112233',
      price_minor: '',
    });
    expect(parsed.color_hex).toBe('#112233');
    expect(parsed.price_minor).toBeNull();
    expect(parsed.category).toBe('Abaya');
  });

  it('rejects an unknown category', () => {
    const parsed = garmentCreateSchema.safeParse({
      shop_id: shopId,
      name: 'Cap',
      sku: 'CAP',
      category: 'Hat',
      color_name: 'Red',
      color_hex: '#ff0000',
      price_minor: '',
    });
    expect(parsed.success).toBe(false);
  });
});
