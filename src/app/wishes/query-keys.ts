export const wishesQueryKey = () => ["wishes"] as const;
export const discoverWishesQueryKey = () => ["wishes", "discover"] as const;
export const memberWishesQueryKey = (memberId: string) => ["members", memberId, "wishes"] as const;

export const HYDRATED_STALE_TIME = 30_000;
