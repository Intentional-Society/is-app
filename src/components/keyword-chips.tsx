// Renders up to `max` keyword chips and a trailing "…" chip when the
// list overflows. Returns null on empty so callers don't need their own
// length-guard around the render site.
export function KeywordChips({
  keywords,
  max = 4,
  className = "mt-1 flex flex-wrap gap-1",
}: {
  keywords: string[];
  max?: number;
  className?: string;
}) {
  const unique = [...new Set(keywords)];
  if (unique.length === 0) return null;
  return (
    <div className={className}>
      {unique.slice(0, max).map((kw, i) => (
        <span key={`${kw}-${i}`} className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          {kw}
        </span>
      ))}
      {unique.length > max && (
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">…</span>
      )}
    </div>
  );
}
