import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/api-server";

import { ProgramSlugDetail } from "./program-slug-detail";

export default async function ProgramDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  await requireUser();
  const { slug } = await params;

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 px-8 pb-8 pt-3">
      <PageHeader title="Program" fallback="/programs" />
      <ProgramSlugDetail slug={slug} />
    </main>
  );
}
