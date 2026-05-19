import Link from "next/link";
import { notFound } from "next/navigation";

import { requireUser } from "@/lib/api-server";

import { ProgramsAdmin } from "./programs-admin";

export default async function AdminProgramsPage() {
  const me = await requireUser();
  // Generic 404 for non-admins, matching the /admin hub page.
  if (!me.profile?.isAdmin) notFound();

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 p-8">
      <div className="flex w-full max-w-xl items-center justify-between">
        <h1 className="text-2xl font-bold">Programs</h1>
        <Link href="/admin" className="text-base text-muted-foreground hover:text-foreground">
          ← Admin
        </Link>
      </div>
      <ProgramsAdmin />
    </main>
  );
}
