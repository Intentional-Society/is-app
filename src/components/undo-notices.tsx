"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import type { UndoEntry } from "@/lib/use-undo-queue";

// Seconds left, ticking once a second while any notice is showing.
function useSecondsLeft(expiresAt: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return Math.max(0, Math.ceil((expiresAt - now) / 1000));
}

function UndoNotice({ entry, onUndo }: { entry: UndoEntry; onUndo: (id: string) => void }) {
  const seconds = useSecondsLeft(entry.expiresAt);
  return (
    <li className="flex items-center justify-between gap-3 rounded bg-muted px-3 py-2 text-sm">
      <span>{entry.message}</span>
      <Button type="button" variant="primary" size="xs" onClick={() => onUndo(entry.id)}>
        Undo ({seconds}s)
      </Button>
    </li>
  );
}

// The "Undo" notices from `useUndoQueue`. Renders nothing when empty. A polite
// live region, so screen readers hear the notice appear.
export function UndoNotices({ entries, onUndo }: { entries: UndoEntry[]; onUndo: (id: string) => void }) {
  return (
    <ul aria-live="polite" className="flex flex-col gap-2 empty:hidden">
      {entries.map((entry) => (
        <UndoNotice key={entry.id} entry={entry} onUndo={onUndo} />
      ))}
    </ul>
  );
}
