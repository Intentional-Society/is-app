import Link from "next/link";

import { requireUser, serverApiClient } from "@/lib/api-server";
import type { MemberSummary } from "@/lib/api-types";

import { MembersList } from "./members-list";

export default async function MembersPage() {
  await requireUser();

  const res = await serverApiClient.api.members.$get();
  if (!res.ok) throw new Error(`Failed to load members: ${res.status}`);
  const { members }: { members: MemberSummary[] } = await res.json();

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 p-8">
      <div className="flex w-full max-w-5xl items-center justify-between">
        <h1 className="text-2xl font-bold">Member directory</h1>
        <Link href="/" className="text-base text-muted-foreground hover:text-foreground">
          ← Back
        </Link>
      </div>

      <MembersList members={members} />
    </main>
  );
}
