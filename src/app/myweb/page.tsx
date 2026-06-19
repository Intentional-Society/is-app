import { dehydrate, HydrationBoundary, QueryClient } from "@tanstack/react-query";
import type { Metadata } from "next";

import { requireUser, serverApiClient } from "@/lib/api-server";
import { titleFor } from "@/lib/page-titles";

import { MyWeb } from "./my-web";
import { DEFAULT_SUBGRAPH_VIEW, RELATION_SUBGRAPH_QUERY_KEY } from "./query-keys";

export const metadata: Metadata = { title: titleFor("/myweb") };

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
    // The web canvas sizes its view-mode height to leave exactly this `pb-8`
    // (2rem) below itself, so it never spills into a scrollbar — useCanvasBox's
    // PAGE_PAD_REM mirrors this value. Change them together.
    <main className="flex min-h-screen flex-col items-center gap-6 px-8 pb-8 pt-3">
      <HydrationBoundary state={dehydrate(queryClient)}>
        <MyWeb initialLastUpdatedWeb={initialLastUpdatedWeb} />
      </HydrationBoundary>
    </main>
  );
}
