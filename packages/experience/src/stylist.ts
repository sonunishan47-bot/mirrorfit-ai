import type { Locale } from '@mirrorfit/types';

import { fitOf, formatPrice, itemInStock, type ExperienceItem } from './catalog';
import { canonicalColor, categoryHint } from './catalog';

export interface ShopQuery {
  readonly color: string | null;
  readonly categoryHint: string | null;
}

export type ShopCommand =
  | { readonly type: 'show'; readonly query: ShopQuery }
  | { readonly type: 'size'; readonly size: string }
  | { readonly type: 'next-color' }
  | { readonly type: 'compare' }
  | { readonly type: 'complete-look' }
  | { readonly type: 'view'; readonly view: 'front' | 'side' | 'back' }
  | { readonly type: 'unknown' };

const SIZE_PATTERN = /\b(XXXL|XXL|XL|XS|S|M|L)\b/i;

function queryFromText(text: string): ShopQuery {
  return { color: canonicalColor(text), categoryHint: categoryHint(text) };
}

/** English and Arabic shop commands. Unknown text is not answered with an invention. */
export function parseShopCommand(text: string): ShopCommand {
  const value = text.trim();
  if (!value) return { type: 'unknown' };
  const lower = value.toLowerCase();

  if (/compare|قارن|مقارنة/.test(lower) || /قارن/.test(value)) return { type: 'compare' };
  if (/another colou?r|لون آخر|لون اخر|لون ثاني/.test(lower) || /لون آخر|لون اخر/.test(value)) {
    return { type: 'next-color' };
  }
  if (
    /complete this look|complete the look|أكمل|اكمل الإطلالة|اكملي/.test(lower) ||
    /أكمل|اكمل/.test(value)
  ) {
    return { type: 'complete-look' };
  }
  if (/\bfront\b|أمام|امامي|الأمام/.test(lower) || /أمام/.test(value))
    return { type: 'view', view: 'front' };
  if (/\bside\b|جانب|الجانب/.test(lower) || /جانب/.test(value))
    return { type: 'view', view: 'side' };
  if (/\bback\b|خلف|الخلف/.test(lower) || /خلف/.test(value)) return { type: 'view', view: 'back' };

  const size = SIZE_PATTERN.exec(value);
  if (size && /size|مقاس|قياس|try/.test(lower + value)) {
    return { type: 'size', size: size[1]!.toUpperCase() };
  }
  if (size && /مقاس|قياس/.test(value)) return { type: 'size', size: size[1]!.toUpperCase() };

  const query = queryFromText(value);
  if (
    /show|أرني|ارني|أظهر|اعرض|عرض/.test(lower) ||
    /أرني|ارني|اعرض/.test(value) ||
    query.color ||
    query.categoryHint
  ) {
    if (query.color || query.categoryHint) return { type: 'show', query };
  }
  return { type: 'unknown' };
}

function colorDistance(a: string, b: string): number {
  const left = canonicalColor(a);
  const right = canonicalColor(b);
  if (left && right && left === right) return 1;
  if (
    left &&
    (left === 'black' || left === 'white' || left === 'beige' || left === 'navy' || left === 'gold')
  ) {
    return 0;
  }
  return left && right ? 0 : 0.5;
}

/** Other in-stock pieces from this catalog. Never creates a garment that is not in the list. */
export function completeLook(
  seed: ExperienceItem,
  catalog: readonly ExperienceItem[],
): ExperienceItem[] {
  const seedFit = fitOf(seed);
  const want = seedFit === 'TOP' ? 'LOWER_BODY' : seedFit === 'LOWER_BODY' ? 'TOP' : null;
  const pool = catalog.filter(
    (item) =>
      itemInStock(item) &&
      item.garmentId !== seed.garmentId &&
      (want === null || fitOf(item) === want),
  );
  return [...pool]
    .sort(
      (a, b) =>
        colorDistance(seed.colorName, a.colorName) - colorDistance(seed.colorName, b.colorName),
    )
    .slice(0, 3);
}

export function rankForHistory(
  catalog: readonly ExperienceItem[],
  selectedCategories: readonly string[],
): ExperienceItem[] {
  const counts = new Map<string, number>();
  for (const category of selectedCategories) {
    const key = category.trim().toLowerCase();
    if (!key) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...catalog].sort((a, b) => {
    const aScore = counts.get(a.category.trim().toLowerCase()) ?? 0;
    const bScore = counts.get(b.category.trim().toLowerCase()) ?? 0;
    return bScore - aScore || a.name.localeCompare(b.name);
  });
}

export function productDescription(item: ExperienceItem, locale: Locale): string {
  const price = formatPrice(item.priceMinor, item.currencyCode, locale);
  const brand = item.brand ? (locale === 'ar' ? ` من ${item.brand}` : ` by ${item.brand}`) : '';
  const priceText = price ? (locale === 'ar' ? ` السعر ${price}.` : ` ${price}.`) : '';
  if (locale === 'ar') {
    return `${item.name} بلون ${item.colorName}. تصنيف ${item.category}${brand}.${priceText} الوصف من بيانات المتجر، وليس نصاً مولَّداً من نموذج.`;
  }
  return `${item.name} in ${item.colorName}. Category ${item.category}${brand}.${priceText} Written from the shop catalog, not from a language model.`;
}

export function assistantReply(
  command: ShopCommand,
  locale: Locale,
  matchCount: number | null,
): string {
  if (command.type === 'unknown') {
    return locale === 'ar'
      ? 'لم أفهم. جرّب: أرني عباية سوداء، مقاس M، لون آخر، قارن، أكمل الإطلالة.'
      : 'Not understood. Try: show black abayas, try size M, another color, compare, complete this look.';
  }
  if (command.type === 'show') {
    if (matchCount === 0) {
      return locale === 'ar'
        ? 'لا توجد قطعة مطابقة في كتالوج هذا المتجر.'
        : 'Nothing in this shop catalog matches that.';
    }
    return locale === 'ar'
      ? `وجدت ${matchCount ?? 0} في هذا المتجر.`
      : `Found ${matchCount ?? 0} in this shop.`;
  }
  if (command.type === 'size') {
    return locale === 'ar' ? `المقاس ${command.size}.` : `Size ${command.size}.`;
  }
  if (command.type === 'next-color') {
    return locale === 'ar'
      ? 'لون آخر من نفس القطعة، إن وُجد.'
      : 'Another color of this garment, if the shop has one.';
  }
  if (command.type === 'compare') {
    return locale === 'ar'
      ? 'المقارنة نصية من الكتالوج، وليست صورتين لك.'
      : 'Compare is catalog text, not two photos of you.';
  }
  if (command.type === 'complete-look') {
    return locale === 'ar'
      ? 'قطع موجودة في المتجر فقط.'
      : 'Only pieces that are already in this shop.';
  }
  return locale === 'ar' ? `عرض المجسم: ${command.view}.` : `Mannequin view: ${command.view}.`;
}

export const UI_COPY = {
  en: {
    resultOnMirror:
      'If you allow one still, the realistic result stays on the mirror. This phone does not receive that photo.',
    notSaved: 'Measurements you type stay on this phone until you leave. They are not uploaded.',
    mannequin: '3D mannequin for size and shape. It is not a photo of you.',
    offline: 'Showing the last catalog saved on this phone. Selections need a connection.',
  },
  ar: {
    resultOnMirror:
      'إذا سمحت بصورة واحدة، تبقى النتيجة على المرآة. هذا الهاتف لا يستلم تلك الصورة.',
    notSaved: 'المقاسات التي تكتبها تبقى على هذا الهاتف حتى المغادرة. لا يتم رفعها.',
    mannequin: 'مجسم ثلاثي الأبعاد للمقاس والشكل. ليس صورة لك.',
    offline: 'آخر كتالوج محفوظ على هذا الهاتف. الاختيار يحتاج اتصالاً.',
  },
} as const;
