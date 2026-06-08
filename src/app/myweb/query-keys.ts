export const RELATION_CANDIDATES_QUERY_KEY = ["relations", "candidates"] as const;
export const RELATION_SUBGRAPH_QUERY_KEY = ["relations", "subgraph"] as const;

export const relationValueQueryKey = (relateeId: string) => ["relations", "value", relateeId] as const;

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
