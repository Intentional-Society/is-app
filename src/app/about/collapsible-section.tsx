import type { ReactNode } from "react";

// Native <details> disclosure for the /about sections — starts closed, no
// client JS. The title stays an <h2> so it keeps its heading role inside
// the <summary>. Chevron treatment matches the agreements accordion; the
// surface matches a dialog (bg-popover + hairline ring). `accessory`
// renders beside the title (e.g. the version pill on Changelog).
export function CollapsibleSection({
  title,
  accessory,
  children,
}: {
  title: string;
  accessory?: ReactNode;
  children: ReactNode;
}) {
  return (
    <details className="group w-full max-w-2xl rounded-xl bg-popover text-popover-foreground ring-1 ring-foreground/10">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-5 py-4 [&::-webkit-details-marker]:hidden">
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          {accessory}
        </div>
        <svg
          viewBox="0 0 12 12"
          aria-hidden="true"
          className="size-3 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m3 4.5 3 3 3-3" />
        </svg>
      </summary>
      <div className="border-t border-border p-5">{children}</div>
    </details>
  );
}
