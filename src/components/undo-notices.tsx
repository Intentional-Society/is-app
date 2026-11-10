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

// The "Undo" notices from `useUndoQueue`. The wrapper is a polite live region
// that stays mounted even when there are no notices, because screen readers
// announce content added to a live region that already exists, not one that
// appears with its text in it. The ticking "(29s)" is aria-hidden and each
// button's accessible name is fixed ("Undo: <what it undoes>"), so nothing is
// re-announced every second and several pending notices can be told apart.
export function UndoNotices({ entries, onUndo }: { entries: UndoEntry[]; onUndo: (id: string) => void }) {
  const now = useNow(entries.length > 0);
  return (
    <div role="status" className="empty:hidden">
      {entries.length > 0 && (
        <ul className="flex flex-col gap-2">
          {entries.map((entry) => (
            <li key={entry.id} className="flex items-center justify-between gap-3 rounded bg-muted px-3 py-2 text-sm">
              <span>{entry.message}</span>
              <Button
                type="button"
                variant="primary"
                size="xs"
                aria-label={`Undo: ${entry.message}`}
                onClick={() => onUndo(entry.id)}
              >
                <span aria-hidden="true">Undo ({Math.max(0, Math.ceil((entry.expiresAt - now) / 1000))}s)</span>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
