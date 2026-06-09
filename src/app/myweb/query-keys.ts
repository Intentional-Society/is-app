import { isRelationValue, RELATION_VALUES, type RelationValue } from "@/lib/relation-value";

export const RELATION_CANDIDATES_QUERY_KEY = ["relations", "candidates"] as const;
export const RELATION_SUBGRAPH_QUERY_KEY = ["relations", "subgraph"] as const;

export const relationValueQueryKey = (relateeId: string) => ["relations", "value", relateeId] as const;

export const relationMiniMapQueryKey = (profileId: string) => ["relations", "mini-map", profileId] as const;

export type SubgraphViewOptions = {
  hops: 1 | 2;
};

// Default view for the WebGraph — server prefetch and client useState
// must agree on this exact shape so the prefetched cache hits on mount.
export const DEFAULT_SUBGRAPH_VIEW: SubgraphViewOptions = {
  hops: 2,
};

// localStorage key the WebGraph persists the viewer's hops choice under, so it
// survives reloads.
export const VIEW_STORAGE_KEY = "isweb-graph-view";

// Permissive parser — any malformed/legacy payload falls back to null (the
// caller then keeps the default). Strict validation matters because the parsed
// shape feeds the useQuery key and would otherwise fire a failing request on
// every mount.
export function parseStoredView(raw: string | null): SubgraphViewOptions | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && "hops" in parsed && (parsed.hops === 1 || parsed.hops === 2)) {
      return { hops: parsed.hops };
    }
  } catch {
    // fall through to null
  }
  return null;
}

// Which relation depths (1..4) the graph draws. A client-side cull over the
// already-fetched subgraph — deliberately NOT part of SubgraphViewOptions (and
// thus the query key), so toggling a depth re-filters the cached data instantly
// rather than refetching. Persisted on its own key so the choice survives
// reloads like hops does.
export type RelationValueFilter = ReadonlySet<RelationValue>;

export const VALUE_FILTER_STORAGE_KEY = "isweb-graph-value-filter";

// Default is every depth shown. A factory rather than a shared Set so no caller
// can mutate a module singleton.
export const defaultValueFilter = (): Set<RelationValue> => new Set(RELATION_VALUES);

// Permissive parser. An explicitly-stored empty array round-trips to an empty
// set — the deliberate "show just me" state — which is distinct from a missing
// or garbled value (null, so the caller keeps the all-shown default).
export function parseStoredValueFilter(raw: string | null): Set<RelationValue> | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return new Set(parsed.filter(isRelationValue));
  } catch {
    // fall through to null
  }
  return null;
}
