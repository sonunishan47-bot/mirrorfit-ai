import type { ReactNode } from 'react';

import { cn } from '@mirrorfit/ui';

/**
 * Garment tile for the phone catalog. Callers pass copy they already have —
 * no invented product data, storage paths, or signed URLs.
 */
export function GarmentCard({
  title,
  category,
  meta,
  selected = false,
  badge,
  children,
}: {
  title: string;
  category: string;
  meta?: string;
  selected?: boolean;
  badge?: string | null;
  children?: ReactNode;
}) {
  return (
    <article
      className={cn(
        'overflow-hidden rounded-[1.5rem] bg-customer-surface shadow-[0_12px_32px_rgb(27_48_34_/_7%)]',
        'transition-[box-shadow,ring] duration-150 ease-mf',
        selected && 'ring-2 ring-forest ring-offset-2 ring-offset-customer',
      )}
      data-selected={selected ? 'true' : undefined}
    >
      <div
        className="relative flex aspect-[3/4] items-end bg-[#ebe6dc] px-4 py-3"
        aria-hidden={!badge}
      >
        {badge ? (
          <span className="rounded-full bg-customer-surface/90 px-3 py-1 text-[0.65rem] font-medium uppercase tracking-[0.18em] text-forest">
            {badge}
          </span>
        ) : null}
      </div>
      <div className="space-y-2 px-4 py-4">
        <p className="text-[0.65rem] font-medium uppercase tracking-[0.28em] text-forest">
          {category}
        </p>
        <h3 className="text-lg font-light tracking-tight text-customer-ink">{title}</h3>
        {meta ? <p className="text-sm text-customer-quiet">{meta}</p> : null}
        {children}
      </div>
    </article>
  );
}
