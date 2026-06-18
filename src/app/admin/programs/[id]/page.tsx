import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { requireUser, serverApiClient } from "@/lib/api-server";

import { ProgramDetail } from "./program-detail";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const res = await serverApiClient.api.admin.programs[":id"].$get({ param: { id } });
  if (!res.ok) return { title: "Admin · Program" };
  const { program } = await res.json();
  return { title: `Admin · ${program.name}` };
}

export default async function AdminProgramDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  // Generic 404 for non-admins, matching the /admin hub page.
  if (!me.profile?.isAdmin) notFound();
  const { id } = await params;

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 px-8 pb-8 pt-3">
      <PageHeader title="Program" fallback="/admin/programs" />
      <ProgramDetail programId={id} />
    </main>
  );
}
