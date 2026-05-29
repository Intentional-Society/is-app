import { redirect } from "next/navigation";

import { Avatar } from "@/components/avatar";
import { BreadcrumbLink } from "@/components/breadcrumb-link";
import { QueryProvider } from "@/components/query-provider";
import { requireUser, serverApiClient } from "@/lib/api-server";
import type { MemberProfile } from "@/lib/api-types";

import { MemberRelationControl } from "./relation-control";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-sm uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="font-serif text-base">{children || <span className="text-muted-foreground">—</span>}</dd>
    </div>
  );
}

export default async function MemberProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireUser();
  const res = await serverApiClient.api.members[":id"].$get({ param: { id } });
  if (res.status === 401) redirect("/signin");
  if (!res.ok && res.status !== 404) throw new Error(`Failed to load member ${id}: ${res.status}`);

  if (res.status === 404) {
    return (
      <main className="flex min-h-screen flex-col items-center gap-6 p-8">
        <div className="flex w-full max-w-md items-center justify-between">
          <h1 className="text-2xl font-bold">Member not found</h1>
          <BreadcrumbLink fallback="/members" />
        </div>
        <p className="text-muted-foreground">We couldn&apos;t find a member with that name or ID.</p>
      </main>
    );
  }

  const { profile }: { profile: MemberProfile } = await res.json();
  const memberSince = new Date(profile.createdAt).getFullYear();

  const isOwnProfile = me.id === profile.id;

  return (
    <QueryProvider>
      <main className="flex min-h-screen flex-col items-center gap-6 p-8">
        <div className="flex w-full max-w-md items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">{profile.displayName ?? "Member"}</h1>
            <p className="text-sm text-muted-foreground">Member since {memberSince}</p>
          </div>
          <BreadcrumbLink fallback="/members" />
        </div>

        <Avatar
          name={profile.displayName}
          url={profile.avatarUrl}
          sizes="128px"
          priority
          className="flex h-32 w-32 items-center justify-center overflow-hidden rounded-full bg-muted text-3xl font-semibold text-muted-foreground"
        />

        {!isOwnProfile && (
          <MemberRelationControl
            memberId={profile.id}
            memberName={profile.displayName}
          />
        )}

        <dl className="flex w-full max-w-md flex-col gap-4">
          <Field label="Bio">{profile.bio}</Field>
          <Field label="Keywords">{profile.keywords.length > 0 ? profile.keywords.join(", ") : null}</Field>
          <Field label="Location">{profile.location}</Field>
          <Field label="Live desire">{profile.liveDesire}</Field>
          <Field label="Supplementary info">{profile.supplementaryInfo}</Field>
        </dl>

        {profile.email && (
          <a
            href={`mailto:${profile.email}`}
            className="text-base text-muted-foreground underline hover:text-foreground"
          >
            Send email
          </a>
        )}
      </main>
    </QueryProvider>
  );
}
