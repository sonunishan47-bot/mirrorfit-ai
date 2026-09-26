import type { GarmentFitCategory } from '@mirrorfit/types';

/**
 * Commercial top / outerwear names mapped to TOP fitting.
 * Plurals included. Keep LOWER_BODY separate — no cross-family invention.
 */
const TOP =
  /^(tops?|shirts?|t-?shirts?|tees?|blouses?|jackets?|hoodies?|sweaters?|coats?|cardigans?|vests?|tunics?|polos?|sweatshirts?|blazers?|windbreakers?)$/i;
const LOWER =
  /^(pants?|trousers?|jeans?|shorts?|skirts?|leggings?|chinos?|joggers?|sweatpants?|cargos?|culottes?|overalls?)$/i;

export function resolveFitCategory(category: string | null | undefined): GarmentFitCategory | null {
  const value = category?.trim() ?? '';
  if (TOP.test(value)) return 'TOP';
  if (LOWER.test(value)) return 'LOWER_BODY';
  return null;
}

export interface TopOverlayDefaults {
  /** Normalized pivot inside the overlay bitmap (shoulder line). */
  readonly anchor: { readonly x: number; readonly y: number };
  /** Multiplier applied to measured shoulder width for draw scaleX. */
  readonly widthFactor: number;
}

export interface LowerOverlayDefaults {
  /** Normalized pivot inside the overlay bitmap (waist / hip line). */
  readonly anchor: { readonly x: number; readonly y: number };
  /** Multiplier applied to measured hip width for draw scaleX. */
  readonly widthFactor: number;
}

const DEFAULT_TOP: TopOverlayDefaults = {
  anchor: { x: 0.5, y: 0.22 },
  widthFactor: 1.35,
};

const DEFAULT_LOWER: LowerOverlayDefaults = {
  anchor: { x: 0.5, y: 0.08 },
  widthFactor: 1.25,
};

/**
 * Category-aware layout hints for TOP overlays.
 *
 * Outerwear sits slightly higher/wider than a tee. Returns null when the
 * category is not a known TOP — callers must not invent lower-body defaults.
 */
export function topOverlayDefaults(
  category: string | null | undefined,
): TopOverlayDefaults | null {
  if (resolveFitCategory(category) !== 'TOP') return null;
  const value = category?.trim().toLowerCase() ?? '';

  if (/^(jackets?|coats?|blazers?|windbreakers?)$/i.test(value)) {
    return { anchor: { x: 0.5, y: 0.18 }, widthFactor: 1.45 };
  }
  if (/^(hoodies?|sweaters?|sweatshirts?|cardigans?)$/i.test(value)) {
    return { anchor: { x: 0.5, y: 0.2 }, widthFactor: 1.4 };
  }
  if (/^(vests?)$/i.test(value)) {
    return { anchor: { x: 0.5, y: 0.24 }, widthFactor: 1.3 };
  }
  if (/^(tunics?|blouses?)$/i.test(value)) {
    return { anchor: { x: 0.5, y: 0.22 }, widthFactor: 1.32 };
  }
  if (/^(polos?|t-?shirts?|tees?|shirts?|tops?)$/i.test(value)) {
    return DEFAULT_TOP;
  }
  return DEFAULT_TOP;
}

/**
 * Category-aware layout hints for LOWER_BODY overlays.
 * Returns null when the category is not a known lower-body family.
 */
export function lowerOverlayDefaults(
  category: string | null | undefined,
): LowerOverlayDefaults | null {
  if (resolveFitCategory(category) !== 'LOWER_BODY') return null;
  const value = category?.trim().toLowerCase() ?? '';

  if (/^(shorts?)$/i.test(value)) {
    return { anchor: { x: 0.5, y: 0.1 }, widthFactor: 1.28 };
  }
  if (/^(skirts?|culottes?)$/i.test(value)) {
    return { anchor: { x: 0.5, y: 0.06 }, widthFactor: 1.32 };
  }
  if (/^(leggings?|joggers?|sweatpants?)$/i.test(value)) {
    return { anchor: { x: 0.5, y: 0.08 }, widthFactor: 1.18 };
  }
  if (/^(jeans?|pants?|trousers?|chinos?|cargos?|overalls?)$/i.test(value)) {
    return DEFAULT_LOWER;
  }
  return DEFAULT_LOWER;
}
