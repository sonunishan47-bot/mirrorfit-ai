import type { ReactNode } from 'react';

export function ErrorState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="space-y-6 text-center" role="alert">
      <div className="space-y-3">
        <h1 className="text-[2rem] font-light leading-snug text-customer-ink">{title}</h1>
        <p className="text-base leading-relaxed text-customer-quiet">{body}</p>
      </div>
      {action}
    </div>
  );
}
