"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { Avatar } from "@/components/avatar";
import { Input } from "@/components/ui/input";
import type { Intention } from "@/lib/api-types";

// Phyllotaxis (sunflower) scatter: index 0 sits dead-centre and each
// subsequent point spirals outward by the golden angle, which spreads N
// points evenly across a disk with no clumping. Because the server hands
// us intentions freshest-first, this lands the freshest one in the
// middle — biggest, on top — and ages outward toward the rim.
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
// Percent of half-width the outermost point reaches. < 50 keeps chips
// off the very edge so a hovered one has room to grow inward.
const MAX_RADIUS = 41;

type Placed = {
  item: Intention;
  left: number; // %
  top: number; // %
  fontSize: number; // px
  baseZ: number;
  haystack: string; // lowercased name + intention, for the filter
};

const place = (intentions: Intention[]): Placed[] => {
  const n = intentions.length;
  const denom = Math.max(n - 1, 1);
  return intentions.map((item, i) => {
    const r = Math.sqrt(i / denom); // 0 at centre → 1 at rim
    const theta = i * GOLDEN_ANGLE;
    return {
      item,
      left: 50 + r * MAX_RADIUS * Math.cos(theta),
      top: 50 + r * MAX_RADIUS * Math.sin(theta),
      // Freshest (centre) ~22px, oldest (rim) ~13px.
      fontSize: 22 - r * 9,
      // Freshest paints on top; the hovered chip overrides this far above.
      baseZ: n - i,
      haystack: `${item.displayName ?? ""} ${item.currentIntention}`.toLowerCase(),
    };
  });
};

export function IntentionsCloud({ intentions }: { intentions: Intention[] }) {
  const [query, setQuery] = useState("");
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const placed = useMemo(() => place(intentions), [intentions]);

  const q = query.trim().toLowerCase();
  const matchCount = q ? placed.filter((p) => p.haystack.includes(q)).length : placed.length;

  if (intentions.length === 0) {
    return (
      <div className="flex w-full max-w-2xl flex-col items-center gap-2 rounded-lg border border-border bg-canvas p-12 text-center">
        <p className="text-base text-muted-foreground">No current intentions yet.</p>
        <p className="text-sm text-muted-foreground">
          Set yours on{" "}
          <Link href="/me" className="underline hover:text-foreground">
            your profile
          </Link>{" "}
          and it&apos;ll show up here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex w-full max-w-2xl flex-col gap-4">
      <div className="relative aspect-square w-full overflow-hidden rounded-lg border border-border bg-canvas">
        {placed.map(({ item, left, top, fontSize, baseZ, haystack }) => {
          const isHovered = hoveredId === item.id;
          const dimmed = q !== "" && !haystack.includes(q);
          // Round to fixed precision so the server- and client-computed values
          // stringify identically — Math.sin/cos can differ in the last ULP
          // between the Node and browser engines, tripping a hydration mismatch.
          const lx = left.toFixed(3);
          // The chip uses w-max (below) so it sizes to its content rather than
          // shrink-fitting to the gap between its left% and the canvas edge —
          // otherwise edge chips wrap narrow before translateX pulls them in.
          return (
            <Link
              key={item.id}
              href={`/members/${item.slug ?? item.id}`}
              aria-label={`${item.displayName ?? "A member"}: ${item.currentIntention}`}
              onMouseEnter={() => setHoveredId(item.id)}
              onMouseLeave={() => setHoveredId((id) => (id === item.id ? null : id))}
              onFocus={() => setHoveredId(item.id)}
              onBlur={() => setHoveredId((id) => (id === item.id ? null : id))}
              style={{
                left: `${lx}%`,
                top: `${top.toFixed(3)}%`,
                fontSize: `${fontSize.toFixed(2)}px`,
                zIndex: isHovered ? 100000 : baseZ,
                // Resting chips stay centred on their point so the scatter reads
                // evenly. On hover the anchor slides continuously with position:
                // translateX(-left%) maps a chip at 0/50/100% across the canvas
                // to a 0/-50/-100% self-anchor, so a centred chip doesn't move
                // and grows both ways while edge chips anchor their inner edge
                // and grow inward — proportional to how close to the edge they
                // are, no abrupt switch. transform-origin tracks it so the scale
                // grows the same direction.
                transform: `translate(${isHovered ? `-${lx}%` : "-50%"}, -50%) scale(${isHovered ? 1.45 : 1})`,
                transformOrigin: `${lx}% center`,
              }}
              className={`group absolute flex w-max max-w-[80%] items-center gap-1.5 rounded-full border border-border bg-card/90 px-2.5 py-1 shadow-sm backdrop-blur-sm transition-[transform,opacity,filter] duration-200 will-change-transform hover:bg-accent focus-visible:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
                isHovered ? "bg-accent shadow-md" : ""
              } ${dimmed ? "pointer-events-none opacity-10 blur-[1px]" : ""}`}
            >
              <Avatar
                name={item.displayName}
                url={item.avatarUrl}
                sizes="24px"
                className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full border border-border bg-muted text-[0.65rem] font-semibold text-muted-foreground [clip-path:circle()]"
              />
              <span className="flex min-w-0 flex-col leading-tight">
                <span className={isHovered ? "max-w-[16rem] whitespace-normal" : "max-w-[9rem] truncate"}>
                  {item.currentIntention}
                </span>
                {isHovered && (
                  <span className="text-[0.7em] text-muted-foreground">— {item.displayName ?? "A member"}</span>
                )}
              </span>
            </Link>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-4">
        <Input
          type="search"
          placeholder="Filter by intention or member…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="max-w-xs"
        />
        <p className="shrink-0 text-sm text-muted-foreground">
          {q ? `${matchCount} of ${placed.length}` : `${placed.length} intentions`}
        </p>
      </div>
    </div>
  );
}
