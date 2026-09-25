import { cn } from '@mirrorfit/ui';

/**
 * Floating pill nav for a later customer surface. `/s` does not mount it:
 * pairing has one job and no destinations.
 */
export function CustomerBottomNav({
  items,
  activeId,
}: {
  items: ReadonlyArray<{ readonly id: string; readonly label: string }>;
  activeId?: string;
}) {
  return (
    <nav
      aria-label="Customer"
      className="pointer-events-auto mx-auto flex w-max max-w-full gap-1 rounded-full bg-customer-surface px-2 py-2 shadow-[0_12px_36px_rgb(27_48_34_/_12%)]"
    >
      {items.map((item) => {
        const active = item.id === activeId;
        return (
          <span
            key={item.id}
            className={cn(
              'rounded-full px-4 py-2 text-xs tracking-wide',
              active ? 'bg-forest text-forest-contrast' : 'text-customer-quiet',
            )}
          >
            {item.label}
          </span>
        );
      })}
    </nav>
  );
}
