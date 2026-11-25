export const wishesQueryKey = () => ["wishes"] as const;
export const discoverWishesQueryKey = () => ["wishes", "discover"] as const;
export const memberWishesQueryKey = (memberId: string) => ["members", memberId, "wishes"] as const;
export const wishReactionsQueryKey = (wishId: string) => ["wishes", wishId, "reactions"] as const;
export const wishCommentsQueryKey = (wishId: string) => ["wishes", wishId, "comments"] as const;

export const HYDRATED_STALE_TIME = 30_000;
