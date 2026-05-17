"use client";

import { useState } from "react";
import type { UrlObject } from "node:url";
import Link from "next/link";

import { Avatar } from "@/components/avatar";
import { KeywordChips } from "@/components/keyword-chips";
import { Input } from "@/components/ui/input";
import type { MemberSummary } from "@/lib/api-types";

function MemberCard({ member }: { member: MemberSummary }) {
  const href: UrlObject = { pathname: `/members/${member.slug ?? member.id}` };
  return (
    <Link
      href={href}
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

export function MembersSearch({ members }: { members: MemberSummary[] }) {
  const [query, setQuery] = useState("");

  const filtered = query.trim()
    ? members.filter((m) => {
        const q = query.toLowerCase();
        return (
          m.displayName.toLowerCase().includes(q) ||
          (m.location?.toLowerCase().includes(q) ?? false) ||
          m.keywords.some((k) => k.toLowerCase().includes(q))
        );
      })
    : members;

  return (
    <div className="flex w-full max-w-5xl flex-col gap-4">
      <Input
        type="search"
        placeholder="Search by name, location, or keyword…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="max-w-sm"
      />

      {filtered.length === 0 ? (
        <p className="text-muted-foreground">
          {query ? "No members match your search." : "No members yet."}
        </p>
      ) : (
        <ul className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {filtered.map((member) => (
            <li key={member.id}>
              <MemberCard member={member} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
