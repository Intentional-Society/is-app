import Link from "next/link";
import { notFound } from "next/navigation";

import { requireUser } from "@/lib/api-server";

import { ProgramDetail } from "./program-detail";

export default async function AdminProgramDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  // Generic 404 for non-admins, matching the /admin hub page.
  if (!me.profile?.isAdmin) notFound();
  const { id } = await params;

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 p-8">
      <div className="flex w-full max-w-xl items-center justify-between">
        <h1 className="text-2xl font-bold">Program</h1>
        <Link href="/admin/programs" className="text-base text-muted-foreground hover:text-foreground">
          ← Programs
        </Link>
      </div>
      <ProgramDetail programId={id} />
    </main>
  );
}
