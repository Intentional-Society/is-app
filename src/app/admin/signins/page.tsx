import { notFound } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/api-server";

import { SigninsAdminPanel } from "./signins-admin-panel";

export default async function AdminSigninsPage() {
  const me = await requireUser();
  // Generic 404 for non-admins, matching the /admin hub page.
  if (!me.profile?.isAdmin) notFound();

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 px-8 pb-8 pt-3">
      <PageHeader title="Sign-ins" fallback="/admin" />
      <SigninsAdminPanel />
    </main>
  );
}
