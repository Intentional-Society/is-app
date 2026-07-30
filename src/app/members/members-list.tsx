"use client";

import type { UrlObject } from "node:url";
import { LayoutGrid, List } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Avatar } from "@/components/avatar";
import { KeywordChips } from "@/components/keyword-chips";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { MemberSummary } from "@/lib/api-types";
import { scoreMember } from "@/lib/member-search";

type ViewMode = "grid" | "list";

function MemberCard({ member }: { member: MemberSummary }) {
  const href: UrlObject = { pathname: `/members/${member.slug ?? member.id}` };
  return (
    // prefetch={false}: the grid can hold dozens of cards, and Next prefetches
    // each one's target page server-side — every render signing that member's
    // avatar via its own Supabase Storage round-trip. That burst can exhaust
    // Storage's DB pool (429). The list already carries everything a card
    // shows; defer the per-page work to an actual click.
    <Link
      href={href}
      prefetch={false}
      className="flex h-full flex-col rounded-sm border border-border hover:bg-muted/50 transition-colors overflow-hidden"
    >
      <Avatar
        name={member.displayName}
        url={member.avatarUrl}
        sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 256px"
        className="flex aspect-square w-full items-center justify-center overflow-hidden bg-muted text-2xl font-semibold text-muted-foreground"
      />
      <div className="flex flex-col gap-1 p-4">
        <span className="font-semibold">{member.displayName}</span>
        {member.location && <span className="text-sm text-muted-foreground">{member.location}</span>}
        <KeywordChips keywords={member.keywords} />
      </div>
    </Link>
  );
}

function MemberRow({ member }: { member: MemberSummary }) {
  const href: UrlObject = { pathname: `/members/${member.slug ?? member.id}` };
  return (
    <Link
      href={href}
      prefetch={false}
      className="flex items-center gap-3 rounded-sm border border-border px-4 py-2 hover:bg-muted/50 transition-colors"
    >
      <Avatar
        name={member.displayName}
        url={member.avatarUrl}
        sizes="40px"
        className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-sm font-semibold text-muted-foreground"
      />
      <div className="flex min-w-0 flex-1 items-center gap-4">
        <span className="shrink-0 font-semibold">{member.displayName}</span>
        {member.location && (
          <span className="hidden shrink-0 text-sm text-muted-foreground sm:inline">{member.location}</span>
        )}
        <div className="hidden min-w-0 flex-1 lg:block">
          <KeywordChips keywords={member.keywords} max={3} className="flex flex-wrap gap-1" />
        </div>
      </div>
    </Link>
  );
}

function ViewToggle({ mode, onChange }: { mode: ViewMode; onChange: (mode: ViewMode) => void }) {
  return (
    <div data-slot="button-group" className="flex">
      <Button
        variant={mode === "grid" ? "primary" : "ghost"}
        size="icon-sm"
        aria-label="Grid view"
        aria-pressed={mode === "grid"}
        onClick={() => onChange("grid")}
      >
        <LayoutGrid />
      </Button>
      <Button
        variant={mode === "list" ? "primary" : "ghost"}
        size="icon-sm"
        aria-label="List view"
        aria-pressed={mode === "list"}
        onClick={() => onChange("list")}
      >
        <List />
      </Button>
    </div>
  );
}

export function MembersList({ members }: { members: MemberSummary[] }) {
  const [query, setQuery] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");

  // Same matcher and threshold as MemberTypeahead (see lib/member-search).
  // Sort by score so the closest matches lead, like the typeahead does.
  const filtered = query.trim()
    ? members
        .map((m) => ({ m, score: scoreMember(m, query) }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score)
        .map(({ m }) => m)
    : members;

  return (
    <div className="flex w-full max-w-5xl flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <Input
          type="search"
          placeholder="Search by name, location, or keyword…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-sm"
        />
        <ViewToggle mode={viewMode} onChange={setViewMode} />
      </div>

      {filtered.length === 0 ? (
        <p className="text-muted-foreground">{query ? "No members match your search." : "No members yet."}</p>
      ) : viewMode === "grid" ? (
        <ul className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {filtered.map((member) => (
            <li key={member.id}>
              <MemberCard member={member} />
            </li>
          ))}
        </ul>
      ) : (
        <ul className="flex w-full flex-col gap-2">
          {filtered.map((member) => (
            <li key={member.id}>
              <MemberRow member={member} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
