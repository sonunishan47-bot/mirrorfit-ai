'use client';

import { useEffect } from 'react';

/**
 * Route-level recovery UI for the customer phone surface.
 */
export default function SessionError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (typeof console !== 'undefined') {
      console.warn('[session] render recovery', error.message.slice(0, 120));
    }
  }, [error]);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-customer px-5 text-customer-ink">
      <div className="w-full max-w-md space-y-4 rounded-[1.75rem] bg-customer-surface px-7 py-10 text-center shadow-[0_18px_50px_rgb(27_48_34_/_8%)]">
        <p className="text-[0.68rem] font-medium uppercase tracking-[0.2em] text-forest">
          MirrorFit AI
        </p>
        <h1 className="text-[2rem] font-light leading-snug">Temporary phone fault</h1>
        <p className="text-base leading-relaxed text-customer-quiet">
          The catalog view hit an unexpected error. Your pairing token was not shown and is not
          written to storage. Try again to continue.
        </p>
        <button
          type="button"
          className="min-h-12 w-full rounded-full bg-forest px-6 text-base font-medium tracking-wide text-forest-contrast"
          onClick={reset}
        >
          Try again
        </button>
      </div>
    </main>
  );
}
