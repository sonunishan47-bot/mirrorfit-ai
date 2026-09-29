import { describe, expect, it } from 'vitest';

import {
  assistantReply,
  buildMannequinSpec,
  cacheIsFresh,
  completeLook,
  estimateFromStatedHeight,
  gestureFromJoints,
  gpuUsageEstimate,
  itemMatchesQuery,
  parseShopCommand,
  productDescription,
  readPlan,
  recommendFromChart,
  recommendFromHeight,
  rollupSelections,
  sanitizeCatalogCache,
  usageAllowed,
  whiteLabel,
  type ExperienceItem,
} from './index';

const shirt: ExperienceItem = {
  garmentId: 'g1',
  variantId: 'v1',
  name: 'Linen shirt',
  category: 'Shirt',
  brand: 'House',
  colorName: 'White',
  sizes: ['S', 'M', 'L'],
  priceMinor: 12000,
  currencyCode: 'SAR',
};

const pants: ExperienceItem = {
  garmentId: 'g2',
  variantId: 'v2',
  name: 'Tailored trousers',
  category: 'Pants',
  brand: null,
  colorName: 'Black',
  sizes: ['M', 'L'],
  priceMinor: null,
  currencyCode: null,
};

const abaya: ExperienceItem = {
  garmentId: 'g3',
  variantId: 'v3',
  name: 'Evening abaya',
  category: 'Abaya',
  brand: null,
  colorName: 'Black',
  sizes: ['M'],
  priceMinor: 45000,
  currencyCode: 'SAR',
  stock: 2,
};

describe('shop commands', () => {
  it('parses English and Arabic without inventing a match', () => {
    expect(parseShopCommand('show me black abayas')).toEqual({
      type: 'show',
      query: { color: 'black', categoryHint: 'abaya' },
    });
    expect(parseShopCommand('أرني عباية سوداء').type).toBe('show');
    expect(parseShopCommand('try size M')).toEqual({ type: 'size', size: 'M' });
    expect(parseShopCommand('مقاس L')).toEqual({ type: 'size', size: 'L' });
    expect(parseShopCommand('another color').type).toBe('next-color');
    expect(parseShopCommand('لون آخر').type).toBe('next-color');
    expect(parseShopCommand('compare these two').type).toBe('compare');
    expect(parseShopCommand('قارن').type).toBe('compare');
    expect(parseShopCommand('complete this look').type).toBe('complete-look');
    expect(parseShopCommand('side view')).toEqual({ type: 'view', view: 'side' });
    expect(parseShopCommand('hello there')).toEqual({ type: 'unknown' });
    expect(assistantReply({ type: 'unknown' }, 'ar', null)).toContain('عباية');
  });

  it('filters only real catalog rows', () => {
    expect(itemMatchesQuery(abaya, { color: 'black', categoryHint: 'abaya' })).toBe(true);
    expect(itemMatchesQuery(shirt, { color: 'black', categoryHint: 'abaya' })).toBe(false);
    expect(
      itemMatchesQuery({ ...abaya, stock: 0 }, { color: 'black', categoryHint: 'abaya' }),
    ).toBe(false);
  });
});

describe('size and outfit', () => {
  it('uses the garment chart and does not guess when nothing overlaps', () => {
    const advice = recommendFromChart(
      [
        {
          label: 'S',
          chestCm: 88,
          waistCm: 70,
          hipCm: 92,
          lengthCm: 68,
          sleeveCm: 58,
          inseamCm: null,
        },
        {
          label: 'M',
          chestCm: 96,
          waistCm: 78,
          hipCm: 100,
          lengthCm: 70,
          sleeveCm: 60,
          inseamCm: null,
        },
      ],
      { chestCm: 95, waistCm: 77, hipCm: 99, heightCm: 170 },
    );
    expect('size' in advice && advice.size).toBe('M');
    expect('source' in advice && advice.source).toBe('chart');
    expect(
      recommendFromChart([], { chestCm: 90, waistCm: null, hipCm: null, heightCm: null }),
    ).toEqual({
      ok: false,
      reason: 'NO_CHART',
    });
    expect(recommendFromHeight(168, ['S', 'M'])).toMatchObject({
      size: 'M',
      source: 'height-prior',
    });
    expect(estimateFromStatedHeight(null, null)).toEqual({ ok: false, reason: 'NEED_HEIGHT' });
    const estimate = estimateFromStatedHeight(170, { shoulderWidth: 0.22, hipWidth: 0.2 });
    expect(estimate.ok).toBe(true);
  });

  it('completes a look only with other shop items', () => {
    expect(completeLook(shirt, [shirt, pants, abaya]).map((item) => item.garmentId)).toEqual([
      'g2',
    ]);
    expect(productDescription(shirt, 'en')).toContain('shop catalog');
    expect(productDescription(abaya, 'ar')).toContain('المتجر');
  });
});

describe('mannequin, plans, cache, analytics', () => {
  it('builds a mannequin pose and reads gestures without touching the camera upload', () => {
    const spec = buildMannequinSpec({
      view: 'side',
      rotationDeg: 90,
      fit: 'FULL_BODY',
      colorHex: '#112233',
      size: 'L',
      length: 1.1,
      sleeve: 1,
      waist: 0.9,
    });
    expect(spec.camera.x).toBeGreaterThan(1);
    expect(spec.garment).toBe('FULL_BODY');
    expect(spec.garmentColor).toBe('#112233');
    expect(
      gestureFromJoints({
        leftWristY: 0.2,
        rightWristY: 0.7,
        leftShoulderY: 0.4,
        rightShoulderY: 0.4,
      }),
    ).toBe('next-view');
    expect(
      gestureFromJoints({
        leftWristY: 0.2,
        rightWristY: 0.2,
        leftShoulderY: 0.4,
        rightShoulderY: 0.4,
      }),
    ).toBe('next-size');
  });

  it('meters plans without pretending a GPU invoice was measured', () => {
    expect(readPlan('enterprise')).toBe('enterprise');
    expect(readPlan(undefined)).toBe('shop');
    expect(usageAllowed('shop', { mirrorsOnline: 1, stillJobsToday: 0 }).stills).toBe(false);
    expect(usageAllowed('brand', { mirrorsOnline: 3, stillJobsToday: 10 }).stills).toBe(true);
    expect(gpuUsageEstimate(2).billableSeconds).toBe(16);
    expect(whiteLabel({ shopName: 'Jeddah Atelier', organizationName: 'House' }).title).toBe(
      'Jeddah Atelier',
    );
  });

  it('caches catalog rows without secrets and counts only stored analytics fields', () => {
    const cached = sanitizeCatalogCache([
      { name: 'Shirt', pairing_token: 'secret', storage_path: '/a', color_name: 'Black' },
    ]);
    expect(JSON.stringify(cached)).not.toMatch(/secret|storage_path/);
    expect(cacheIsFresh(1_000, 1_000 + 60_000)).toBe(true);
    expect(cacheIsFresh(1_000, 1_000 + 13 * 60 * 60 * 1000)).toBe(false);
    const rollup = rollupSelections(4, [
      { sessionId: 'a', category: 'Abaya', color: 'Black', size: 'M', garmentId: 'g3' },
      { sessionId: 'a', category: 'Abaya', color: 'Black', size: null, garmentId: 'g3' },
      { sessionId: 'b', category: 'Shirt', color: null, size: 'L', garmentId: 'g1' },
    ]);
    expect(rollup.selectionRate).toBe(0.5);
    expect(rollup.colors).toEqual([{ label: 'Black', count: 2 }]);
    expect(rollup.sizes).toEqual([
      { label: 'L', count: 1 },
      { label: 'M', count: 1 },
    ]);
    expect(rollup.mostTried[0]).toEqual({ label: 'g3', count: 2 });
  });
});
