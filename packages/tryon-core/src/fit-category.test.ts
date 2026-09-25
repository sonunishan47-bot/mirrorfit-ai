import { describe, expect, it } from 'vitest';

import { resolveFitCategory } from './fit-category';

describe('resolveFitCategory', () => {
  it('maps shirt family names to TOP', () => {
    expect(resolveFitCategory('Tops')).toBe('TOP');
    expect(resolveFitCategory('T-Shirt')).toBe('TOP');
    expect(resolveFitCategory('hoodie')).toBe('TOP');
  });

  it('maps jeans and trousers to LOWER_BODY', () => {
    expect(resolveFitCategory('Jeans')).toBe('LOWER_BODY');
    expect(resolveFitCategory('pants')).toBe('LOWER_BODY');
  });

  it('does not invent a family for an unknown category', () => {
    expect(resolveFitCategory('Hats')).toBeNull();
    expect(resolveFitCategory('')).toBeNull();
    expect(resolveFitCategory(null)).toBeNull();
  });
});
