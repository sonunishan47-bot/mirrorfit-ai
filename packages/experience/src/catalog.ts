import { resolveFitCategory } from '@mirrorfit/tryon-core';
import type { GarmentFitCategory, Locale, SizeLabel } from '@mirrorfit/types';
import { SIZE_LABELS } from '@mirrorfit/types';

/** A shop catalog row. Stock is optional; missing means the row is already active. */
export interface ExperienceItem {
  readonly garmentId: string;
  readonly variantId: string;
  readonly name: string;
  readonly category: string;
  readonly brand: string | null;
  readonly colorName: string;
  readonly sizes: readonly string[];
  readonly priceMinor: number | null;
  readonly currencyCode: string | null;
  readonly stock?: number | null;
}

export function itemInStock(item: ExperienceItem): boolean {
  return item.stock === undefined || item.stock === null || item.stock > 0;
}

export function fitOf(item: ExperienceItem): GarmentFitCategory | null {
  return resolveFitCategory(item.category);
}

const COLOR_WORDS: Readonly<Record<string, readonly string[]>> = {
  black: ['black', 'أسود', 'سوداء', 'سود'],
  white: ['white', 'أبيض', 'بيضاء'],
  navy: ['navy', 'كحلي'],
  beige: ['beige', 'بيج', 'كريمي'],
  red: ['red', 'أحمر', 'حمراء'],
  blue: ['blue', 'أزرق', 'زرقاء'],
  green: ['green', 'أخضر', 'خضراء'],
  gold: ['gold', 'ذهبي', 'ذهبية'],
  brown: ['brown', 'بني', 'بنية'],
  pink: ['pink', 'وردي', 'وردية'],
};

const CATEGORY_HINTS: Readonly<Record<string, RegExp>> = {
  abaya: /abaya|عبا/i,
  dress: /dress|فستان/i,
  thobe: /thobe|ثوب/i,
  kurta: /kurta|كورت/i,
  churidar: /churidar/i,
  shirt: /shirt|top|قميص|بلوز/i,
  pants: /pant|trouser|jean|بنطال|جينز/i,
};

export function canonicalColor(text: string): string | null {
  const value = text.trim().toLowerCase();
  if (!value) return null;
  for (const [canonical, words] of Object.entries(COLOR_WORDS)) {
    if (words.some((word) => value.includes(word))) return canonical;
  }
  return null;
}

export function categoryHint(text: string): string | null {
  for (const [hint, pattern] of Object.entries(CATEGORY_HINTS)) {
    if (pattern.test(text)) return hint;
  }
  return null;
}

export function itemMatchesQuery(
  item: ExperienceItem,
  query: { readonly color: string | null; readonly categoryHint: string | null },
): boolean {
  if (!itemInStock(item)) return false;
  if (query.color) {
    const color = canonicalColor(item.colorName) ?? item.colorName.toLowerCase();
    if (color !== query.color && !item.colorName.toLowerCase().includes(query.color)) return false;
  }
  if (query.categoryHint) {
    const pattern = CATEGORY_HINTS[query.categoryHint];
    const haystack = `${item.category} ${item.name}`;
    if (pattern && !pattern.test(haystack) && !pattern.test(query.categoryHint)) return false;
    if (pattern && !pattern.test(haystack)) return false;
  }
  return query.color !== null || query.categoryHint !== null;
}

const COLOR_HEX: Readonly<Record<string, string>> = {
  black: '#161616',
  white: '#f3f0e8',
  navy: '#1c2c4a',
  beige: '#d8c7a8',
  red: '#8e2f2f',
  blue: '#2f4f73',
  green: '#1f3d32',
  gold: '#b8943e',
  brown: '#6b4a32',
  pink: '#c48b96',
};

export function colorHex(name: string | null | undefined): string {
  const canonical = name ? canonicalColor(name) : null;
  if (canonical && COLOR_HEX[canonical]) return COLOR_HEX[canonical];
  return '#1f3d32';
}

export function isSizeLabel(value: string | null | undefined): value is SizeLabel {
  return SIZE_LABELS.some((label) => label === value);
}

export function formatPrice(
  priceMinor: number | null,
  currencyCode: string | null,
  locale: Locale,
): string | null {
  if (priceMinor === null || !currencyCode) return null;
  try {
    return new Intl.NumberFormat(locale === 'ar' ? 'ar' : 'en', {
      style: 'currency',
      currency: currencyCode,
    }).format(priceMinor / 100);
  } catch {
    return `${(priceMinor / 100).toFixed(2)} ${currencyCode}`;
  }
}
