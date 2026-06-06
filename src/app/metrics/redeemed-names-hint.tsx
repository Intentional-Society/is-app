"use client";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

// A "?" beside the Redeemed count: clicking it lists the members who
// joined by redeeming an invite. Renders nothing when the list is empty,
// so the "?" only appears when there's something to show. These are
// members, so the names are fine to show on the member-facing page.
export function RedeemedNamesHint({ names }: { names: { id: string; name: string | null }[] }) {
  if (names.length === 0) return null;
  return (
    <Popover>
      <PopoverTrigger
        aria-label="Show members who redeemed an invite"
        className="ml-1.5 inline-flex size-4 items-center justify-center rounded-full text-[10px] font-medium text-muted-foreground ring-1 ring-foreground/20 hover:bg-muted hover:text-foreground"
      >
        ?
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 gap-1.5">
        <p className="text-xs font-medium text-muted-foreground">Redeemed · {names.length}</p>
        <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
          {names.map((n) => (
            <li key={n.id} className="text-sm text-foreground">
              {n.name ?? <span className="text-muted-foreground italic">Unnamed member</span>}
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
