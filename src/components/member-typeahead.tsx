"use client";

import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { useId, useMemo, useState } from "react";

import { Avatar } from "@/components/avatar";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { apiClient } from "@/lib/api";
import type { MemberSummary } from "@/lib/api-types";
import { memberKeywords, memberSearchFilter } from "@/lib/member-search";

const MEMBERS_QUERY_KEY = ["members"] as const;

const fetchMembers = async (): Promise<MemberSummary[]> => {
  const res = await apiClient.api.members.$get();
  if (!res.ok) throw new Error(`members: ${res.status}`);
  const body = await res.json();
  return body.members;
};

export function MemberTypeahead({
  label,
  triggerLabel = "Add a member…",
  selectedLabel,
  selectedIds,
  excludeIds,
  onSelect,
  disabled,
}: {
  label: string;
  triggerLabel?: string;
  // When set, the trigger shows this in foreground tone instead of the
  // muted `triggerLabel`. Use for single-pick flows (admin hints) where
  // the button doubles as the current-selection display. Leave undefined
  // for multi-pick flows (invite hints) where chips track the picks.
  selectedLabel?: string | null;
  selectedIds: string[];
  excludeIds?: string[];
  onSelect: (member: MemberSummary) => void;
  disabled?: boolean;
}) {
  const triggerId = useId();
  const [open, setOpen] = useState(false);

  const { data: members, isPending } = useQuery({
    queryKey: MEMBERS_QUERY_KEY,
    queryFn: fetchMembers,
    staleTime: 5 * 60 * 1000,
  });

  const hidden = useMemo(() => new Set([...(excludeIds ?? []), ...selectedIds]), [excludeIds, selectedIds]);
  const visible = useMemo(() => (members ?? []).filter((m) => !hidden.has(m.id)), [members, hidden]);

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={triggerId}>{label}</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              id={triggerId}
              type="button"
              variant="primary"
              disabled={disabled}
              className="w-full justify-between"
            >
              {selectedLabel ? (
                <span>{selectedLabel}</span>
              ) : (
                <span className="text-muted-foreground">{triggerLabel}</span>
              )}
              <ChevronDown className="h-4 w-4 opacity-50" />
            </Button>
          }
        />
        <PopoverContent
          align="start"
          className="w-(--anchor-width) p-0"
          style={{ maxHeight: "var(--available-height)" }}
        >
          <Command filter={memberSearchFilter}>
            <CommandInput placeholder="Search members…" />
            <CommandList className="max-h-[min(300px,calc(var(--available-height)-52px))] overflow-y-auto">
              <CommandEmpty>{isPending ? "Loading…" : "No member found."}</CommandEmpty>
              <CommandGroup>
                {visible.map((m) => (
                  <CommandItem
                    key={m.id}
                    value={m.displayName ?? ""}
                    keywords={memberKeywords(m)}
                    onSelect={() => {
                      onSelect(m);
                      // Closing on every pick is friendlier than staying
                      // open — clicking the trigger again reopens it and
                      // multi-add stays a 2-click affair instead of a
                      // can't-tell-if-it-worked flicker.
                      setOpen(false);
                    }}
                  >
                    <Avatar
                      name={m.displayName}
                      url={m.avatarUrl}
                      className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-[10px] font-semibold text-muted-foreground"
                    />
                    <span className="flex flex-col">
                      <span className="text-sm font-semibold">{m.displayName ?? "—"}</span>
                      {m.location && <span className="text-xs text-muted-foreground">{m.location}</span>}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

// Small chip with an X to remove. Pulled out so the invite form and the
// admin-hint UI render the same chip.
export function MemberChip({
  member,
  onRemove,
  disabled,
}: {
  member: Pick<MemberSummary, "id" | "displayName">;
  onRemove: (id: string) => void;
  disabled?: boolean;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-sm">
      <span>{member.displayName ?? "—"}</span>
      <button
        type="button"
        onClick={() => onRemove(member.id)}
        disabled={disabled}
        className="text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        aria-label={`Remove ${member.displayName ?? "member"}`}
      >
        ×
      </button>
    </span>
  );
}
