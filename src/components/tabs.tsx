import { cn } from "@/lib/utils";

// Shared tab chrome for /me and the welcome profile step. Rendering
// element follows docs/strategy-ui.md "Buttons vs anchors": pass href
// when a tab changes the URL (/me's #profile/#settings anchors), or
// onClick when it only swaps panels in place (welcome step).

export function TabBar({ ariaLabel, children }: { ariaLabel: string; children: React.ReactNode }) {
  return (
    <div role="tablist" aria-label={ariaLabel} className="flex w-full max-w-md border-b border-border">
      {children}
    </div>
  );
}

type TabProps = {
  active: boolean;
  children: React.ReactNode;
  "data-tour"?: string;
} & ({ href: string; onClick?: never } | { href?: never; onClick: () => void });

export function Tab({ active, children, href, onClick, ...rest }: TabProps) {
  const className = cn(
    "-mb-px border-b-2 px-4 py-2 text-base",
    active ? "border-primary font-semibold" : "border-transparent text-muted-foreground hover:text-foreground",
  );
  if (href !== undefined) {
    return (
      <a role="tab" aria-selected={active} href={href} className={className} {...rest}>
        {children}
      </a>
    );
  }
  return (
    <button type="button" role="tab" aria-selected={active} onClick={onClick} className={className} {...rest}>
      {children}
    </button>
  );
}
