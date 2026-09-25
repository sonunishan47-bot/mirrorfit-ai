import type { ReactNode } from 'react';

import { cn } from '@mirrorfit/ui';

/**
 * Light customer chrome. Staff and kiosk pages stay on the dark tokens.
 */
export function CustomerShell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn('min-h-dvh bg-customer px-5 text-customer-ink', className)}
      style={{
        colorScheme: 'light',
        paddingTop: 'max(2.5rem, env(safe-area-inset-top))',
        paddingBottom: 'max(2rem, env(safe-area-inset-bottom))',
      }}
    >
      <div className="mx-auto flex min-h-[calc(100dvh-4.5rem)] w-full max-w-md flex-col">
        {children}
      </div>
    </div>
  );
}
