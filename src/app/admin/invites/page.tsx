import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/api-server";
import { titleFor } from "@/lib/page-titles";

import { InvitesAdmin } from "./invites-admin";

export const metadata: Metadata = { title: titleFor("/admin/invites") };

export default async function AdminInvitesPage() {
  const me = await requireUser();
  // Generic 404 for non-admins, matching the /admin hub page.
  if (!me.profile?.isAdmin) notFound();

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 px-8 pb-8 pt-3">
      <PageHeader title="Invites" fallback="/admin" />
      <InvitesAdmin />
    </main>
  );
}
