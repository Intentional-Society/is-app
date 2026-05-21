export const RELATION_CANDIDATES_QUERY_KEY = ["relations", "candidates"] as const;
export const RELATION_SUBGRAPH_QUERY_KEY = ["relations", "subgraph"] as const;

export const relationValueQueryKey = (relateeId: string) => ["relations", "value", relateeId] as const;

export type SubgraphViewOptions = {
  includeIncoming: boolean;
  hops: 1 | 2;
};

// Default view for the WebGraph — server prefetch and client useState
// must agree on this exact shape so the prefetched cache hits on mount.
export const DEFAULT_SUBGRAPH_VIEW: SubgraphViewOptions = {
  includeIncoming: false,
  hops: 2,
};
