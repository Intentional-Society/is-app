import { useCallback, useEffect, useRef, useState } from "react";

export const UNDO_WINDOW_MS = 30_000;

export type UndoEntry = {
  // Identifies what was acted on (e.g. a message id). Adding an entry with an
  // existing id replaces it and restarts the window.
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

// A short-lived list of "you just did X, Undo" notices. Each entry lives for
// `windowMs`, then calls its `onExpire` and goes away. Leaving the page (the
// owning component unmounting) cancels the timers WITHOUT running `onExpire`,
// so an action that was only half-done, like a delete waiting out its window,
// is left in its safe state instead of being finished behind the admin's back.
export function useUndoQueue({
  windowMs = UNDO_WINDOW_MS,
  onError,
}: {
  windowMs?: number;
  // Called when an undo or an expiry action throws, so the owner can show it.
  onError?: (error: unknown) => void;
} = {}) {
  const [entries, setEntries] = useState<UndoEntry[]>([]);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const entriesRef = useRef<UndoEntry[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const drop = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
    entriesRef.current = entriesRef.current.filter((e) => e.id !== id);
    setEntries(entriesRef.current);
  }, []);

  const add = useCallback(
    (entry: Omit<UndoEntry, "expiresAt">) => {
      const existing = timers.current.get(entry.id);
      if (existing) clearTimeout(existing);
      const full: UndoEntry = { ...entry, expiresAt: Date.now() + windowMs };
      entriesRef.current = [...entriesRef.current.filter((e) => e.id !== entry.id), full];
      setEntries(entriesRef.current);
      timers.current.set(
        entry.id,
        setTimeout(async () => {
          drop(entry.id);
          try {
            await entry.onExpire?.();
          } catch (error) {
            onErrorRef.current?.(error);
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
      drop(id);
      try {
        await entry.onUndo();
      } catch (error) {
        onErrorRef.current?.(error);
      }
    },
    [drop],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  return { entries, add, undo };
}
