import { dehydrate, HydrationBoundary, QueryClient } from "@tanstack/react-query";

import { BreadcrumbLink } from "@/components/breadcrumb-link";
import { requireUser, serverApiClient } from "@/lib/api-server";

import { MyWeb } from "./my-web";
import { DEFAULT_SUBGRAPH_VIEW, RELATION_SUBGRAPH_QUERY_KEY } from "./query-keys";

export default async function MyWebPage() {
  const me = await requireUser();
  // ProfileForSelf surfaces lastUpdatedWeb as a Date; the JSON wire
  // arrives as an ISO string, so reconstruct here for the client.
  const raw = me.profile?.lastUpdatedWeb ?? null;
  const initialLastUpdatedWeb = typeof raw === "string" ? new Date(raw) : raw;

  // Prefetch the default-view subgraph and dehydrate it into the client
  // QueryClient via HydrationBoundary, so WebGraph's useQuery hits a
  // warm cache on mount instead of doing a post-hydration roundtrip.
  // Toggling 2-hops still falls through to a client fetch (that view
  // variant isn't prefetched).
  const queryClient = new QueryClient();
  await queryClient.prefetchQuery({
    queryKey: [...RELATION_SUBGRAPH_QUERY_KEY, DEFAULT_SUBGRAPH_VIEW],
    queryFn: async () => {
      const res = await serverApiClient.api.relations.subgraph.$get({
        query: {
          hops: String(DEFAULT_SUBGRAPH_VIEW.hops),
        },
      });
      if (!res.ok) throw new Error(`relations/subgraph SSR: ${res.status}`);
      return res.json();
    },
  });

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 p-8">
      <div className="flex w-full max-w-5xl items-center justify-between">
        <h1 className="text-2xl font-bold">My web</h1>
        <BreadcrumbLink fallback="/" />
      </div>
      <HydrationBoundary state={dehydrate(queryClient)}>
        <MyWeb initialLastUpdatedWeb={initialLastUpdatedWeb} />
      </HydrationBoundary>
    </main>
  );
}
