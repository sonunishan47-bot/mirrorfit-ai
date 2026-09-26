import { describe, expect, it } from 'vitest';

import {
  CatalogSelectionGuard,
  catalogBrowseFamily,
  filterCatalogItems,
  fittingAvailabilityLabel,
  formatCatalogPrice,
  groupCatalogByGarment,
} from './catalog-browse';
import type { CustomerCatalogItem } from './catalog-client';

const TOP: CustomerCatalogItem = {
  garmentId: '33333333-3333-4333-8333-333333333333',
  variantId: '55555555-5555-4555-8555-555555555555',
  name: 'Shop tee',
  category: 'Tops',
  brand: 'Lab',
  colorName: 'Black',
  isTestFixture: false,
  sizes: ['S', 'M'],
  hasThumbnail: false,
  hasOverlay: true,
  fittingAvailable: true,
  priceMinor: 4500,
  currencyCode: 'USD',
};

const TOP_RED: CustomerCatalogItem = {
  ...TOP,
  variantId: '66666666-6666-4666-8666-666666666666',
  colorName: 'Red',
};

const JEANS: CustomerCatalogItem = {
  garmentId: '44444444-4444-4444-8444-444444444444',
  variantId: '77777777-7777-4777-8777-777777777777',
  name: 'Shop jeans',
  category: 'Jeans',
  brand: null,
  colorName: 'Indigo',
  isTestFixture: false,
  sizes: ['30', '32'],
  hasThumbnail: false,
  hasOverlay: false,
  fittingAvailable: true,
  priceMinor: null,
  currencyCode: null,
};

const OUTFIT: CustomerCatalogItem = {
  garmentId: '88888888-8888-4888-8888-888888888888',
  variantId: '99999999-9999-4999-8999-999999999999',
  name: 'Weekend set',
  category: 'Outfits',
  brand: null,
  colorName: 'Sand',
  isTestFixture: false,
  sizes: [],
  hasThumbnail: false,
  hasOverlay: false,
  fittingAvailable: false,
  priceMinor: 12000,
  currencyCode: 'USD',
};

describe('catalog browse helpers', () => {
  it('maps categories into browse families without inventing fit', () => {
    expect(catalogBrowseFamily('Tops')).toBe('tops');
    expect(catalogBrowseFamily('Jeans')).toBe('bottoms');
    expect(catalogBrowseFamily('Outfits')).toBe('outfits');
    expect(catalogBrowseFamily('Hats')).toBe('other');
  });

  it('filters catalog rows by browse family', () => {
    const all = [TOP, JEANS, OUTFIT];
    expect(filterCatalogItems(all, 'tops')).toEqual([TOP]);
    expect(filterCatalogItems(all, 'bottoms')).toEqual([JEANS]);
    expect(filterCatalogItems(all, 'outfits')).toEqual([OUTFIT]);
    expect(filterCatalogItems(all, 'all')).toHaveLength(3);
  });

  it('groups color variants under one garment', () => {
    const groups = groupCatalogByGarment([TOP, TOP_RED, JEANS]);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.variants).toHaveLength(2);
    expect(groups[0]?.variants.map((v) => v.colorName)).toEqual(['Black', 'Red']);
    expect(groups[1]?.name).toBe('Shop jeans');
  });

  it('formats prices when currency is present and stays null otherwise', () => {
    expect(formatCatalogPrice(4500, 'USD')).toMatch(/45/);
    expect(formatCatalogPrice(null, 'USD')).toBeNull();
    expect(formatCatalogPrice(100, null)).toBeNull();
  });

  it('labels fitting availability honestly', () => {
    expect(fittingAvailabilityLabel(TOP)).toBe('Ready to try on the mirror');
    expect(fittingAvailabilityLabel({ ...TOP, hasOverlay: false })).toBe(
      'Fitting available · overlay asset pending',
    );
    expect(fittingAvailabilityLabel(OUTFIT)).toBe('Browse only · not fitted on mirror');
  });

  it('drops superseded selection generations', () => {
    const guard = new CatalogSelectionGuard();
    const first = guard.begin();
    const second = guard.begin();
    expect(guard.isCurrent(first)).toBe(false);
    expect(guard.isCurrent(second)).toBe(true);
    guard.invalidate();
    expect(guard.isCurrent(second)).toBe(false);
  });
});
