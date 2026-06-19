import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { requireUser, serverApiClient } from "@/lib/api-server";

import { ProgramSlugDetail } from "./program-slug-detail";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const res = await serverApiClient.api.programs["by-slug"][":slug"].$get({ param: { slug } });
  if (res.status === 404) return { title: "Program not found" };
  if (!res.ok) return { title: "Program" };
  const { program } = await res.json();
  return { title: program.name };
}

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
