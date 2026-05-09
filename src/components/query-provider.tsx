"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

// One QueryClient per browser tab, instantiated once on mount.
// Server-rendered routes don't pass through this provider — they call
// the API in-process via serverApiClient instead, so per-request cache
// isolation isn't a concern here.
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Defer to per-query staleTime for anything chatty; the
            // global default of 0 forces a refetch on every mount,
            // which is wrong for the suggestion feed but right for
            // the rest of the app.
            staleTime: 0,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
