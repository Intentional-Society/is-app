"use client";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

// A "?" beside an invite count: clicking it lists the inviter notes ("who
// are you inviting?") for those invites. Renders nothing when the list is
// empty, so the "?" only appears when there's something to show. Lives on
// the admin-only page — the notes name real people.
export function InviteNotesHint({ label, notes }: { label: string; notes: { id: string; note: string }[] }) {
  if (notes.length === 0) return null;
  return (
    <Popover>
      <PopoverTrigger
        aria-label={`Show notes for ${label.toLowerCase()} invites`}
        className="ml-1.5 inline-flex size-4 items-center justify-center rounded-full text-[10px] font-medium text-muted-foreground ring-1 ring-foreground/20 hover:bg-muted hover:text-foreground"
      >
        ?
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 gap-1.5">
        <p className="text-xs font-medium text-muted-foreground">
          {label} · {notes.length}
        </p>
        <ul className="flex max-h-64 flex-col gap-1 overflow-y-auto">
          {notes.map((n) => (
            <li key={n.id} className="text-sm text-foreground">
              {n.note}
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
