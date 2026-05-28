import { BreadcrumbLink } from "@/components/breadcrumb-link";
import { requireUser } from "@/lib/api-server";

import { ProgramSlugDetail } from "./program-slug-detail";

export default async function ProgramDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  await requireUser();
  const { slug } = await params;

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 p-8">
      <div className="flex w-full max-w-3xl items-center justify-between">
        <h1 className="text-2xl font-bold">Program</h1>
        <BreadcrumbLink fallback="/programs" />
      </div>
      <ProgramSlugDetail slug={slug} />
    </main>
  );
}
