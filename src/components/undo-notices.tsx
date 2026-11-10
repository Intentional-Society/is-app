"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import type { UndoEntry } from "@/lib/use-undo-queue";

// One clock for the whole list, ticking once a second while any notice shows.
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

// The "Undo" notices from `useUndoQueue`. Renders nothing when empty.
//
// Only the notice text is a live region, so a screen reader announces the
// notice once when it appears. The ticking "(29s)" is visual only
// (aria-hidden) and the button keeps a static accessible name, "Undo", so
// nothing is re-announced every second.
export function UndoNotices({ entries, onUndo }: { entries: UndoEntry[]; onUndo: (id: string) => void }) {
  const now = useNow(entries.length > 0);
  return (
    <ul className="flex flex-col gap-2 empty:hidden">
      {entries.map((entry) => (
        <li key={entry.id} className="flex items-center justify-between gap-3 rounded bg-muted px-3 py-2 text-sm">
          <span role="status">{entry.message}</span>
          <Button type="button" variant="primary" size="xs" aria-label="Undo" onClick={() => onUndo(entry.id)}>
            <span aria-hidden="true">Undo ({Math.max(0, Math.ceil((entry.expiresAt - now) / 1000))}s)</span>
          </Button>
        </li>
      ))}
    </ul>
  );
}
