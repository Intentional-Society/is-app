import { useCallback, useState } from "react";

// A set of ids held in state, for per-row flags such as "request in flight" or
// "last attempt failed". `setMember(id, true)` adds an id, `false` removes it.
// The updater copies the set, so overlapping updates from different rows never
// overwrite each other.
export function useIdSet(): [ReadonlySet<string>, (id: string, member: boolean) => void] {
  const [ids, setIds] = useState<ReadonlySet<string>>(() => new Set());
  const setMember = useCallback((id: string, member: boolean) => {
    setIds((prev) => {
      if (prev.has(id) === member) return prev;
      const next = new Set(prev);
      if (member) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  return [ids, setMember];
}
