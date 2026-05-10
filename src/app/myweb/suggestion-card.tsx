"use client";

import type { RelationCandidate } from "@/lib/api-types";

function Initials({ name }: { name: string | null }) {
  const initials = (name ?? "?")
    .split(" ")
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return (
    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-muted text-base font-semibold text-muted-foreground">
      {initials || "?"}
    </div>
  );
}

function Avatar({ candidate }: { candidate: RelationCandidate }) {
  if (candidate.avatarUrl) {
    return (
      <div className="h-12 w-12 shrink-0 overflow-hidden rounded-full">
        {/* biome-ignore lint/performance/noImgElement: avatarUrl is user-supplied and can come from any host */}
        <img src={candidate.avatarUrl} alt="" className="h-full w-full object-cover" />
      </div>
    );
  }
  return <Initials name={candidate.displayName} />;
}

function ReasonLine({ reason }: { reason: RelationCandidate["reason"] }) {
  switch (reason.type) {
    case "ratedYou":
      return <span className="text-sm text-muted-foreground">rated you</span>;
    case "hint": {
      const name = reason.hintedBy?.displayName ?? "Someone";
      return <span className="text-sm text-muted-foreground">{name} suggested you know each other</span>;
    }
    case "viaInviter":
      return (
        <span className="text-sm text-muted-foreground">
          via {reason.inviter.displayName ?? "your inviter"}
        </span>
      );
    case "recentlyActive":
      return <span className="text-sm text-muted-foreground">recently active</span>;
    case "member":
      // Source 5 ("everybody else") is the catch-all — no derived signal,
      // so the card stands on its own without a reason chip.
      return null;
  }
}

export function SuggestionCard({
  candidate,
  onClick,
}: {
  candidate: RelationCandidate;
  onClick?: (candidate: RelationCandidate) => void;
}) {
  const interactive = onClick !== undefined;
  const handleClick = interactive ? () => onClick(candidate) : undefined;

  return (
    <article
      onClick={handleClick}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick(candidate);
              }
            }
          : undefined
      }
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      className={`flex w-full items-start gap-3 rounded border border-border p-3 ${
        interactive ? "cursor-pointer hover:bg-muted/50 focus:bg-muted/50 focus:outline-none focus-visible:ring-3 focus-visible:ring-ring/50" : ""
      }`}
    >
      <Avatar candidate={candidate} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="font-semibold">{candidate.displayName ?? "—"}</span>
          <ReasonLine reason={candidate.reason} />
        </div>
        {candidate.location && <span className="text-sm text-muted-foreground">{candidate.location}</span>}
        {candidate.bio && <p className="text-base text-foreground line-clamp-2">{candidate.bio}</p>}
        {candidate.keywords.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {candidate.keywords.slice(0, 4).map((kw) => (
              <span
                key={kw}
                className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
              >
                {kw}
              </span>
            ))}
            {candidate.keywords.length > 4 && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">…</span>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
