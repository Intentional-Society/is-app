import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/api-server";

import { ProgramDetail } from "./program-detail";

export default async function AdminProgramDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  // Generic 404 for non-admins, matching the /admin hub page.
  if (!me.profile?.isAdmin) notFound();
  const { id } = await params;

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 px-8 pb-8 pt-3">
      <PageHeader
        title="Program"
        right={
          <Link
            href="/admin/programs"
            className="shrink-0 whitespace-nowrap text-base text-muted-foreground hover:text-foreground"
          >
            ← Programs
          </Link>
        }
      />
      <ProgramDetail programId={id} />
    </main>
  );
}
