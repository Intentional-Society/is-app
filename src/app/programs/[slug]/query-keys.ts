// Shared by the server page (which prefetches into these keys) and the client
// components (whose useQuery calls read them), so the hydrated cache hits on
// mount. Kept out of the "use client" files so the server can import them.
export const programQueryKey = (slug: string) => ["programs", "by-slug", slug] as const;

export const messageBoxQueryKey = (programId: string) => ["programs", programId, "message-box"] as const;

// Hydrated data should count as fresh for a moment; the app-wide default of 0
// would refetch on mount and throw the server prefetch away.
export const HYDRATED_STALE_TIME = 30_000;
