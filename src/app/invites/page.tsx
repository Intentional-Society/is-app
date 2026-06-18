import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/api-server";
import { titleFor } from "@/lib/page-titles";

import { InvitesPanel } from "./invites-panel";

export const metadata: Metadata = { title: titleFor("/invites") };

export default async function InvitesPage() {
  const me = await requireUser();

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 px-8 pb-8 pt-3">
      <PageHeader title="Invites" />
      <InvitesPanel me={me} />
    </main>
  );
}
