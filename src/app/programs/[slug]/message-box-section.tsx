import { dehydrate, HydrationBoundary, QueryClient } from "@tanstack/react-query";

import { serverApiClient } from "@/lib/api-server";

import { MessageBox } from "./message-box";
import { MESSAGE_BOX_CARD_CLASSNAME } from "./message-box-card";
import { messageBoxQueryKey } from "./query-keys";

// Server Component for the message-box program feature. Prefetches the box
// into a QueryClient and hydrates it, so the client's useQuery mounts on a warm
// cache (docs/design-programs.md, "Rendering"). The page wraps this in its own
// <Suspense>, so a slow box delays only itself.
export async function MessageBoxSection({ programId }: { programId: string }) {
  const queryClient = new QueryClient();
  await queryClient.prefetchQuery({
    queryKey: messageBoxQueryKey(programId),
    queryFn: async () => {
      const res = await serverApiClient.api.programs[":id"]["message-box"].$get({ param: { id: programId } });
      if (!res.ok) throw new Error(`programs/${programId}/message-box SSR: ${res.status}`);
      return res.json();
    },
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <MessageBox programId={programId} />
    </HydrationBoundary>
  );
}

export function MessageBoxFallback() {
  return (
    <section aria-busy="true" className={MESSAGE_BOX_CARD_CLASSNAME}>
      <h3 className="text-base font-semibold uppercase tracking-wide text-muted-foreground">Message box</h3>
      <p className="text-sm text-muted-foreground">Loading…</p>
    </section>
  );
}
