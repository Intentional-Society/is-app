import { dehydrate, HydrationBoundary, QueryClient } from "@tanstack/react-query";
import type { Metadata } from "next";
import { cache, Suspense } from "react";

import { PageHeader } from "@/components/page-header";
import { requireUser, serverApiClient } from "@/lib/api-server";
import type { ProgramDetail } from "@/lib/api-types";
import { MESSAGE_BOX_FEATURE } from "@/lib/program-features";

import { MessageBoxFallback, MessageBoxSection } from "./message-box-section";
import { ProgramSlugDetail } from "./program-slug-detail";
import { programQueryKey } from "./query-keys";

// generateMetadata and the page both need the program; cache() makes that one
// API call per request. Resolves to the program, or the HTTP status that
// stopped it.
const loadProgram = cache(async (slug: string): Promise<{ program: ProgramDetail } | { status: number }> => {
  const res = await serverApiClient.api.programs["by-slug"][":slug"].$get({ param: { slug } });
  // 404 first: it narrows the response union, so `program` below is defined.
  if (res.status === 404) return { status: 404 };
  if (!res.ok) return { status: res.status };
  const { program } = await res.json();
  return { program };
});

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const result = await loadProgram(slug);
  if ("program" in result) return { title: result.program.name };
  return { title: result.status === 404 ? "Program not found" : "Program" };
}

export default async function ProgramDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  await requireUser();
  const { slug } = await params;
  const result = await loadProgram(slug);

  // Seed the client QueryClient through HydrationBoundary, so ProgramSlugDetail's
  // useQuery mounts on a warm cache. A missing or failed program isn't seeded;
  // the client fetches it and shows its own error.
  const queryClient = new QueryClient();
  if ("program" in result) queryClient.setQueryData(programQueryKey(slug), result.program);

  // One section per attached program feature (docs/design-programs.md,
  // "Rendering"). Each is an async Server Component in its own <Suspense>, so
  // sections fetch in parallel and a slow one delays only itself.
  const program = "program" in result ? result.program : null;

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 px-8 pb-8 pt-3">
      <PageHeader title="Program" fallback="/programs" />
      <HydrationBoundary state={dehydrate(queryClient)}>
        <ProgramSlugDetail slug={slug}>
          {program?.features.includes(MESSAGE_BOX_FEATURE) && (
            <Suspense fallback={<MessageBoxFallback />}>
              <MessageBoxSection programId={program.id} />
            </Suspense>
          )}
        </ProgramSlugDetail>
      </HydrationBoundary>
    </main>
  );
}
