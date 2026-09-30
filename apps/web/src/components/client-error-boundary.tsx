'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Client error boundary for kiosk / phone surfaces.
 *
 * Catches render failures so a camera or catalog exception cannot blank the
 * whole page. Does not log secrets, frames, or storage paths.
 */
export class ClientErrorBoundary extends Component<
  {
    readonly children: ReactNode;
    readonly title?: string;
    readonly body?: string;
    readonly onError?: (message: string) => void;
    readonly resetLabel?: string;
  },
  { readonly hasError: boolean; readonly message: string | null }
> {
  override state: { readonly hasError: boolean; readonly message: string | null } = {
    hasError: false,
    message: null,
  };

  static getDerivedStateFromError(error: unknown): {
    readonly hasError: boolean;
    readonly message: string | null;
  } {
    const message = error instanceof Error ? error.message.slice(0, 160) : 'Something went wrong.';
    return { hasError: true, message };
  }

  override componentDidCatch(error: Error, _info: ErrorInfo): void {
    const message = error.message.slice(0, 160);
    this.props.onError?.(message);
  }

  override render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }
    return (
      <div
        className="space-y-3 rounded-2xl border border-white/10 bg-black/40 px-5 py-6 text-left"
        role="alert"
        data-testid="client-error-boundary"
      >
        <p className="text-sm font-medium uppercase tracking-[0.2em] text-accent">
          {this.props.title ?? 'Temporary problem'}
        </p>
        <p className="text-sm text-secondary">
          {this.props.body ??
            'This panel hit an unexpected error. The rest of the session can continue.'}
        </p>
        {this.state.message ? <p className="text-xs text-muted">{this.state.message}</p> : null}
        <button
          type="button"
          className="text-xs uppercase tracking-[0.25em] text-muted underline-offset-4 hover:text-secondary hover:underline"
          onClick={() => {
            this.setState({ hasError: false, message: null });
          }}
        >
          {this.props.resetLabel ?? 'Try again'}
        </button>
      </div>
    );
  }
}
