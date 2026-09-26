import { cn } from '@mirrorfit/ui';

export function PrimaryButton({
  children,
  busy = false,
  busyLabel = 'Connecting…',
  disabled = false,
  onClick,
}: {
  children: string;
  busy?: boolean;
  busyLabel?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      aria-busy={busy}
      className={cn(
        'min-h-12 w-full rounded-full bg-forest px-6 text-base font-medium tracking-wide text-forest-contrast',
        'transition-opacity duration-150 ease-mf',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest focus-visible:ring-offset-4 focus-visible:ring-offset-customer-surface',
        'disabled:cursor-wait disabled:opacity-70',
      )}
    >
      {busy ? busyLabel : children}
    </button>
  );
}
