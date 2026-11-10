import { useCallback, useEffect, useRef, useState } from "react";

export const UNDO_WINDOW_MS = 30_000;

export type UndoEntry = {
  // Identifies what was acted on (e.g. a message id). Only one entry per id
  // can be pending. A pending entry that has an onExpire (a scheduled permanent
  // delete) is never dropped or restarted: a second add for that id is ignored.
  // A pending entry with no onExpire (a plain "Archived" notice) is replaced by
  // an add that has one, so Archive followed by Delete becomes a delete.
  id: string;
  // Shown in the notice, e.g. "Archived Ada's message."
  message: string;
  // Runs when the admin clicks Undo.
  onUndo: () => void | Promise<void>;
  // Runs if the window passes without an undo, e.g. the permanent delete.
  onExpire?: () => void | Promise<void>;
  // Epoch ms when the window closes, set by `add`.
  expiresAt: number;
};

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : "Something went wrong.");

// A short-lived list of "you just did X, Undo" notices. Each entry lives for
// `windowMs`, then calls its `onExpire` and goes away. Leaving the page (the
// owning component unmounting) cancels the timers WITHOUT running `onExpire`,
// so an action that was only half-done, like a delete waiting out its window,
// is left in its safe state instead of being finished behind the admin's back.
// For the same reason `add` does nothing once the owner has unmounted: an action
// that finishes after the admin left (a slow request) must not start a timer
// that nothing will ever cancel.
//
// `error` holds the message from the latest failed undo or expiry. It clears
// when a new entry is added or an undo is attempted, so it never outlives the
// action it describes.
export function useUndoQueue({ windowMs = UNDO_WINDOW_MS }: { windowMs?: number } = {}) {
  const [entries, setEntries] = useState<UndoEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const entriesRef = useRef<UndoEntry[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const mounted = useRef(true);

  const drop = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    entriesRef.current = entriesRef.current.filter((e) => e.id !== id);
    setEntries(entriesRef.current);
  }, []);

  const add = useCallback(
    (entry: Omit<UndoEntry, "expiresAt">) => {
      if (!mounted.current) return;
      const pending = entriesRef.current.find((e) => e.id === entry.id);
      if (pending) {
        if (pending.onExpire || !entry.onExpire) return;
        drop(entry.id);
      }
      setError(null);
      const full: UndoEntry = { ...entry, expiresAt: Date.now() + windowMs };
      entriesRef.current = [...entriesRef.current, full];
      setEntries(entriesRef.current);
      timers.current.set(
        entry.id,
        setTimeout(async () => {
          drop(entry.id);
          try {
            await entry.onExpire?.();
          } catch (e) {
            setError(messageOf(e));
          }
        }, windowMs),
      );
    },
    [windowMs, drop],
  );

  const undo = useCallback(
    async (id: string) => {
      const entry = entriesRef.current.find((e) => e.id === id);
      if (!entry) return;
      setError(null);
      drop(id);
      try {
        await entry.onUndo();
      } catch (e) {
        setError(messageOf(e));
      }
    },
    [drop],
  );

  useEffect(() => {
    const pending = timers.current;
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  // For failures the owner sees outside the queue (say the archive request that
  // would have created an entry), so they show in the same place; null clears.
  const reportError = useCallback((message: string | null) => setError(message), []);

  return { entries, add, undo, error, reportError };
}
