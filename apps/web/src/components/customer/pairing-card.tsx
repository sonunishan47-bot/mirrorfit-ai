import type { ReactNode } from 'react';

import { cn } from '@mirrorfit/ui';

export function PairingCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={cn(
        'w-full rounded-[1.75rem] bg-customer-surface px-7 py-10 shadow-[0_18px_50px_rgb(27_48_34_/_8%)]',
        className,
      )}
    >
      {children}
    </section>
  );
}
