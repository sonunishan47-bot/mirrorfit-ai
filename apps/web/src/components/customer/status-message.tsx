export function StatusMessage({
  title,
  body,
  live = 'polite',
}: {
  title: string;
  body: string;
  live?: 'polite' | 'off';
}) {
  return (
    <div
      className="space-y-3 text-center"
      role={live === 'off' ? undefined : 'status'}
      aria-live={live}
    >
      <h1 className="text-[2rem] font-light leading-snug text-customer-ink">{title}</h1>
      <p className="text-base leading-relaxed text-customer-quiet">{body}</p>
    </div>
  );
}
