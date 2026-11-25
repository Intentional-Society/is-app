import { dehydrate, HydrationBoundary, QueryClient } from "@tanstack/react-query";
import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { QueryProvider } from "@/components/query-provider";
import { requireUser, serverApiClient } from "@/lib/api-server";
import { titleFor } from "@/lib/page-titles";

import { discoverWishesQueryKey, HYDRATED_STALE_TIME, wishesQueryKey } from "./query-keys";
import { DiscoverContent, WishesContent } from "./wishes-page";
import { WishesTabs } from "./wishes-tabs";

export const metadata: Metadata = { title: titleFor("/wishes") };

export default async function WishesPage() {
  const user = await requireUser();

  const queryClient = new QueryClient();
  await Promise.all([
    queryClient.prefetchQuery({
      queryKey: wishesQueryKey(),
      queryFn: async () => {
        const res = await serverApiClient.api.wishes.$get();
        if (!res.ok) throw new Error(`wishes SSR: ${res.status}`);
        return res.json();
      },
      staleTime: HYDRATED_STALE_TIME,
    }),
    queryClient.prefetchQuery({
      queryKey: discoverWishesQueryKey(),
      queryFn: async () => {
        const res = await serverApiClient.api.wishes.discover.$get();
        if (!res.ok) throw new Error(`wishes discover SSR: ${res.status}`);
        return res.json();
      },
      staleTime: HYDRATED_STALE_TIME,
    }),
  ]);

  return (
    <QueryProvider>
      <HydrationBoundary state={dehydrate(queryClient)}>
        <main className="flex min-h-screen flex-col items-center gap-6 px-8 pb-8 pt-3">
          <PageHeader title="Wishes" />
          <WishesTabs
            myWishes={<WishesContent currentUserId={user.id} />}
            discover={<DiscoverContent currentUserId={user.id} />}
          />
        </main>
      </HydrationBoundary>
    </QueryProvider>
  );
}
