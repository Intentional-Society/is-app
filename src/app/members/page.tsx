import Link from "next/link";

import { requireUser } from "@/lib/api-server";
import { serverApiClient } from "@/lib/api-server";
import type { MemberSummary } from "@/lib/api-types";

function MemberCard({ member }: { member: MemberSummary }) {
  return (
    <Link
      href={`/members/${member.id}`}
      className="flex flex-col gap-1 rounded border border-border p-4 hover:bg-muted/50 transition-colors"
    >
      <span className="font-semibold">{member.displayName}</span>
      {member.location && (
        <span className="text-sm text-muted-foreground">{member.location}</span>
      )}
      {member.keywords.length > 0 && (
        <span className="text-sm text-muted-foreground">
          {member.keywords.slice(0, 4).join(", ")}
          {member.keywords.length > 4 ? "…" : ""}
        </span>
      )}
    </Link>
  );
}

export default async function MembersPage() {
  await requireUser();

  const res = await serverApiClient.api.members.$get();
  if (!res.ok) throw new Error(`Failed to load members: ${res.status}`);
  const { members }: { members: MemberSummary[] } = await res.json();

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 p-8">
      <div className="flex w-full max-w-lg items-center justify-between">
        <h1 className="text-2xl font-bold">Member directory</h1>
        <Link href="/" className="text-base text-muted-foreground hover:text-foreground">
          ← Back
        </Link>
      </div>

      {members.length === 0 ? (
        <p className="text-muted-foreground">No members yet.</p>
      ) : (
        <ul className="flex w-full max-w-lg flex-col gap-3">
          {members.map((member) => (
            <li key={member.id}>
              <MemberCard member={member} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
