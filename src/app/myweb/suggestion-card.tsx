"use client";

import { Tooltip } from "@base-ui/react/tooltip";

import { Avatar } from "@/components/avatar";
import type { RelationCandidate } from "@/lib/api-types";

const reasonText = (reason: RelationCandidate["reason"]): string | null => {
  switch (reason.type) {
    case "addedYou":
      return "Added you to their web";
    case "hint":
      return `${reason.hintedBy?.displayName ?? "Someone"} suggested you know each other`;
    case "viaInviter":
      return `Via ${reason.inviter.displayName ?? "your inviter"}`;
    case "recentlyActive":
      return "Recently active";
    case "member":
      // Source 5 ("everybody else") — no signal, no indicator.
      return null;
  }
};

// Corner indicator: a soft-pink right triangle in the card's top-right
// with a punched-out circle (filled with the card background so it
// reads as transparent) and a darker exclamation point inside it.
// Triangle vertices in the 32×32 viewBox: (0,0), (32,0), (32,32) —
// right-angle at the top-right corner; circle sits near the centroid.
function ReasonIndicator({ text }: { text: string }) {
  return (
    <Tooltip.Root delay={150}>
      <Tooltip.Trigger
        render={
          <span className="absolute top-0 right-0 inline-block h-7 w-7">
            <svg viewBox="0 0 32 32" className="h-full w-full" role="img" aria-label={text}>
              <path d="M0 0 L32 0 L32 32 Z" className="fill-pink-200" />
              <circle cx="22" cy="10" r="5.5" className="fill-background" />
              <text
                x="22"
                y="13.5"
                textAnchor="middle"
                className="fill-pink-600"
                fontSize="10"
                fontWeight="700"
                fontFamily="sans-serif"
              >
                !
              </text>
            </svg>
          </span>
        }
      />
      <Tooltip.Portal>
        <Tooltip.Positioner sideOffset={4}>
          <Tooltip.Popup className="rounded border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md">
            {text}
          </Tooltip.Popup>
        </Tooltip.Positioner>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
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
  const reason = reasonText(candidate.reason);

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
      className={`relative flex w-full flex-col items-center gap-1 overflow-hidden rounded border border-border p-2 text-center ${
        interactive
          ? "cursor-pointer hover:bg-muted/50 focus:bg-muted/50 focus:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          : ""
      }`}
    >
      {reason && <ReasonIndicator text={reason} />}
      <Avatar
        name={candidate.displayName}
        url={candidate.avatarUrl}
        className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-base font-semibold text-muted-foreground"
      />
      <span className="line-clamp-1 text-sm font-semibold">{candidate.displayName ?? "—"}</span>
      {candidate.location && <span className="line-clamp-1 text-xs text-muted-foreground">{candidate.location}</span>}
    </article>
  );
}
