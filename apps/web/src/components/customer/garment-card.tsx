/**
 * Visual language for a future garment tile.
 *
 * Not wired to a catalog. Callers pass the words they already have.
 */
export function GarmentCard({
  title,
  category,
  meta,
}: {
  title: string;
  category: string;
  meta?: string;
}) {
  return (
    <article className="overflow-hidden rounded-[1.5rem] bg-customer-surface shadow-[0_12px_32px_rgb(27_48_34_/_7%)]">
      <div className="aspect-[3/4] bg-[#ebe6dc]" aria-hidden />
      <div className="space-y-1 px-4 py-4">
        <p className="text-[0.65rem] font-medium uppercase tracking-[0.28em] text-forest">
          {category}
        </p>
        <h3 className="text-lg font-light tracking-tight text-customer-ink">{title}</h3>
        {meta ? <p className="text-sm text-customer-quiet">{meta}</p> : null}
      </div>
    </article>
  );
}
