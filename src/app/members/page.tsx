import type { UrlObject } from "node:url";
import Link from "next/link";

import { Avatar } from "@/components/avatar";
import { KeywordChips } from "@/components/keyword-chips";
import { requireUser, serverApiClient } from "@/lib/api-server";
import type { MemberSummary } from "@/lib/api-types";

function MemberCard({ member }: { member: MemberSummary }) {
  const href: UrlObject = { pathname: `/members/${member.slug ?? member.id}` };
  return (
    <Link
      href={href}
      className="flex h-full flex-col rounded border border-border hover:bg-muted/50 transition-colors overflow-hidden"
    >
      <Avatar
        name={member.displayName}
        url={member.avatarUrl}
        sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 256px"
        className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-t-sm bg-muted text-2xl font-semibold text-muted-foreground"
      />
      <div className="flex flex-col gap-1 p-4">
        <span className="font-semibold">{member.displayName}</span>
        {member.location && <span className="text-sm text-muted-foreground">{member.location}</span>}
        <KeywordChips keywords={member.keywords} />
      </div>
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
      <div className="flex w-full max-w-5xl items-center justify-between">
        <h1 className="text-2xl font-bold">Member directory</h1>
        <Link href="/" className="text-base text-muted-foreground hover:text-foreground">
          ← Back
        </Link>
      </div>

      {members.length === 0 ? (
        <p className="text-muted-foreground">No members yet.</p>
      ) : (
        <ul className="grid w-full max-w-5xl grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
