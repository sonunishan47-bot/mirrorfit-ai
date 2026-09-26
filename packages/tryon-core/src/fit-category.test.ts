import { describe, expect, it } from 'vitest';

import { resolveFitCategory, lowerOverlayDefaults, topOverlayDefaults } from './fit-category';

describe('resolveFitCategory', () => {
  it('maps shirt family names to TOP', () => {
    expect(resolveFitCategory('Tops')).toBe('TOP');
    expect(resolveFitCategory('T-Shirt')).toBe('TOP');
    expect(resolveFitCategory('hoodie')).toBe('TOP');
  });

  it('maps expanded commercial top names including plurals', () => {
    const names = [
      'shirt',
      'shirts',
      't-shirt',
      'tee',
      'tees',
      'top',
      'blouse',
      'jacket',
      'jackets',
      'hoodie',
      'sweater',
      'coat',
      'cardigan',
      'vest',
      'tunic',
      'polo',
      'sweatshirt',
      'blazer',
      'windbreaker',
      'windbreakers',
    ];
    for (const name of names) {
      expect(resolveFitCategory(name), name).toBe('TOP');
    }
  });

  it('maps jeans and trousers to LOWER_BODY', () => {
    expect(resolveFitCategory('Jeans')).toBe('LOWER_BODY');
    expect(resolveFitCategory('pants')).toBe('LOWER_BODY');
    expect(resolveFitCategory('leggings')).toBe('LOWER_BODY');
  });

  it('does not invent a family for an unknown category', () => {
    expect(resolveFitCategory('Hats')).toBeNull();
    expect(resolveFitCategory('')).toBeNull();
    expect(resolveFitCategory(null)).toBeNull();
  });
});

describe('topOverlayDefaults', () => {
  it('returns null for non-TOP categories', () => {
    expect(topOverlayDefaults('Jeans')).toBeNull();
    expect(topOverlayDefaults(null)).toBeNull();
  });

  it('gives jackets a slightly higher/wider anchor than tees', () => {
    const tee = topOverlayDefaults('T-Shirt');
    const jacket = topOverlayDefaults('Jacket');
    expect(tee).not.toBeNull();
    expect(jacket).not.toBeNull();
    expect(jacket!.anchor.y).toBeLessThan(tee!.anchor.y);
    expect(jacket!.widthFactor).toBeGreaterThan(tee!.widthFactor);
  });
});

describe('lowerOverlayDefaults', () => {
  it('returns null for non-LOWER_BODY categories', () => {
    expect(lowerOverlayDefaults('T-Shirt')).toBeNull();
    expect(lowerOverlayDefaults(null)).toBeNull();
  });

  it('maps jeans and shorts with distinct layout hints', () => {
    const jeans = lowerOverlayDefaults('Jeans');
    const shorts = lowerOverlayDefaults('Shorts');
    expect(jeans).not.toBeNull();
    expect(shorts).not.toBeNull();
    expect(shorts!.widthFactor).toBeGreaterThan(jeans!.widthFactor);
  });

  it('maps expanded lower-body names', () => {
    for (const name of ['chinos', 'joggers', 'sweatpants', 'cargos', 'skirts']) {
      expect(resolveFitCategory(name), name).toBe('LOWER_BODY');
      expect(lowerOverlayDefaults(name), name).not.toBeNull();
    }
  });
});
