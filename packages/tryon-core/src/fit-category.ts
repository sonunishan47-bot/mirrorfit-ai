import type { GarmentFitCategory } from '@mirrorfit/types';

const TOP = /^(tops?|shirts?|t-?shirts?|tees?|blouses?|jackets?|hoodies?|sweaters?|coats?)$/i;
const LOWER = /^(pants?|trousers?|jeans?|shorts?|skirts?|leggings?)$/i;

export function resolveFitCategory(category: string | null | undefined): GarmentFitCategory | null {
  const value = category?.trim() ?? '';
  if (TOP.test(value)) return 'TOP';
  if (LOWER.test(value)) return 'LOWER_BODY';
  return null;
}
