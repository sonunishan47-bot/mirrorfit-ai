'use client';

import { useEffect } from 'react';

/**
 * Route-level recovery UI for the kiosk. Next.js renders this when a child
 * segment throws during render. Does not expose stack traces with secrets.
 */
export default function MirrorError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (typeof console !== 'undefined') {
      console.warn('[mirror] render recovery', error.message.slice(0, 120));
    }
  }, [error]);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-base px-10 text-primary">
      <div className="space-y-4 text-center" role="alert" data-testid="mirror-route-error">
        <p className="text-xs uppercase tracking-[0.35em] text-accent">MirrorFit AI</p>
        <h1 className="text-3xl font-light tracking-wide">Temporary display fault</h1>
        <p className="max-w-md text-sm text-secondary">
          Something failed while drawing this screen. Your device enrollment is unchanged. The live
          camera stays on this device.
        </p>
        <button
          type="button"
          className="text-xs uppercase tracking-[0.25em] text-muted underline-offset-4 hover:text-secondary hover:underline"
          onClick={reset}
        >
          Reload mirror UI
        </button>
      </div>
    </main>
  );
}
