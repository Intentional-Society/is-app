"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Avatar } from "@/components/avatar";

type Rect = { left: number; top: number; width: number; height: number };

// A clone of a just-related suggestion card that flies from its list slot
// (sourceRect, viewport coords) to a target point (the graph center),
// shrinking and decelerating in (ease-out), then fading out over the last
// 20% via a delayed opacity transition. Portaled to <body> so it isn't
// clipped by the list/graph. Calls onDone after durationMs so the parent can
// close the list hole and let the new graph node ease in from the center.
export function FlyCard({
  card,
  sourceRect,
  target,
  durationMs,
  onDone,
}: {
  card: { displayName: string | null; avatarUrl: string | null; location: string | null };
  sourceRect: Rect;
  target: { x: number; y: number };
  durationMs: number;
  onDone: () => void;
}) {
  const [animateIn, setAnimateIn] = useState(false);
  // Read the latest onDone without re-running the effect (which would restart
  // the timer) if the parent re-renders mid-flight.
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    const raf = requestAnimationFrame(() => setAnimateIn(true));
    const timer = window.setTimeout(() => onDoneRef.current(), durationMs);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [durationMs]);

  const dx = target.x - (sourceRect.left + sourceRect.width / 2);
  const dy = target.y - (sourceRect.top + sourceRect.height / 2);
  const fadeStart = Math.round(durationMs * 0.8);
  const fadeDur = durationMs - fadeStart;

  return createPortal(
    <div
      aria-hidden
      className="pointer-events-none fixed z-50 flex flex-col items-center gap-1 overflow-hidden rounded border border-border bg-background p-2 text-center shadow-lg"
      style={{
        left: sourceRect.left,
        top: sourceRect.top,
        width: sourceRect.width,
        transformOrigin: "center",
        transform: animateIn ? `translate(${dx}px, ${dy}px) scale(0.6)` : "translate(0px, 0px) scale(1)",
        opacity: animateIn ? 0 : 1,
        transition: `transform ${durationMs}ms cubic-bezier(0, 0, 0.2, 1), opacity ${fadeDur}ms ease-in ${fadeStart}ms`,
        willChange: "transform, opacity",
      }}
    >
      <Avatar
        name={card.displayName}
        url={card.avatarUrl}
        className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-base font-semibold text-muted-foreground"
      />
      <span className="line-clamp-1 text-sm font-semibold">{card.displayName ?? "—"}</span>
      {card.location && <span className="line-clamp-1 text-xs text-muted-foreground">{card.location}</span>}
    </div>,
    document.body,
  );
}
