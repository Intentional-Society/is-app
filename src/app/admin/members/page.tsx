import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/api-server";
import { titleFor } from "@/lib/page-titles";

import { MemberEmailsPanel } from "./member-emails-panel";
import { MembersAdminPanel } from "./members-admin-panel";

export const metadata: Metadata = { title: titleFor("/admin/members") };

export default async function AdminMembersPage() {
  const me = await requireUser();
  // Generic 404 for non-admins, matching the /admin hub page.
  if (!me.profile?.isAdmin) notFound();

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 px-8 pb-8 pt-3">
      <PageHeader title="Members" fallback="/admin" />
      <MembersAdminPanel currentUserId={me.profile.id} />

      <section className="flex w-full max-w-xl flex-col gap-2">
        <h2 className="text-lg font-semibold">Email addresses</h2>
        <MemberEmailsPanel />
      </section>
    </main>
  );
}
