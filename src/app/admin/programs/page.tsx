import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/api-server";

import { ProgramsAdmin } from "./programs-admin";

export default async function AdminProgramsPage() {
  const me = await requireUser();
  // Generic 404 for non-admins, matching the /admin hub page.
  if (!me.profile?.isAdmin) notFound();

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 px-8 pb-8 pt-3">
      <PageHeader
        title="Programs"
        right={
          <Link
            href="/admin"
            className="shrink-0 whitespace-nowrap text-base text-muted-foreground hover:text-foreground"
          >
            ← Admin
          </Link>
        }
      />
      <ProgramsAdmin />
    </main>
  );
}
