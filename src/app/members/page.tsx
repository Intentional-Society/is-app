import Link from "next/link";
import type { UrlObject } from "node:url";

import { requireUser, serverApiClient } from "@/lib/api-server";
import type { MemberSummary } from "@/lib/api-types";

function MemberAvatar({ member }: { member: MemberSummary }) {
  const initials = member.displayName
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  if (member.avatarUrl) {
    return (
      <div className="aspect-square w-full overflow-hidden rounded-t-sm">
        {/* biome-ignore lint/performance/noImgElement: avatarUrl is user-supplied and can come from any host */}
        <img
          src={member.avatarUrl}
          alt={member.displayName}
          className="h-full w-full object-cover"
        />
      </div>
    );
  }

  return (
    <div className="flex aspect-square w-full items-center justify-center rounded-t-sm bg-muted text-2xl font-semibold text-muted-foreground">
      {initials}
    </div>
  );
}

function MemberCard({ member }: { member: MemberSummary }) {
  const href: UrlObject = { pathname: `/members/${member.slug ?? member.id}` };
  return (
    <Link
      href={href}
      className="flex h-full flex-col rounded border border-border hover:bg-muted/50 transition-colors overflow-hidden"
    >
      <MemberAvatar member={member} />
      <div className="flex flex-col gap-1 p-4">
        <span className="font-semibold">{member.displayName}</span>
        {member.location && (
          <span className="text-sm text-muted-foreground">{member.location}</span>
        )}
        {member.keywords.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {member.keywords.slice(0, 4).map((kw) => (
              <span
                key={kw}
                className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
              >
                {kw}
              </span>
            ))}
            {member.keywords.length > 4 && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">…</span>
            )}
          </div>
        )}
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
