import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { requireUser, serverApiClient } from "@/lib/api-server";
import type { MemberSummary } from "@/lib/api-types";
import { titleFor } from "@/lib/page-titles";

import { MembersList } from "./members-list";

export const metadata: Metadata = { title: titleFor("/members") };

export default async function MembersPage() {
  await requireUser();

  const res = await serverApiClient.api.members.$get();
  if (!res.ok) throw new Error(`Failed to load members: ${res.status}`);
  const { members }: { members: MemberSummary[] } = await res.json();

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 px-8 pb-8 pt-3">
      <PageHeader title="Member directory" />

      <MembersList members={members} />
    </main>
  );
}
