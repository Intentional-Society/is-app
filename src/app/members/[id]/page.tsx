import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cache } from "react";

import { Avatar } from "@/components/avatar";
import { PageHeader } from "@/components/page-header";
import { QueryProvider } from "@/components/query-provider";
import { requireUser, serverApiClient } from "@/lib/api-server";
import type { MemberProfile } from "@/lib/api-types";

import { ProfileMiniMap } from "./profile-mini-map";
import { MemberRelationControl } from "./relation-control";

type MemberLoad = { status: "ok"; profile: MemberProfile } | { status: "not-found" } | { status: "unauthorized" };

// cache() dedupes this across generateMetadata and the page render, so
// the profile is fetched once per request despite both needing it.
const loadMember = cache(async (id: string): Promise<MemberLoad> => {
  const res = await serverApiClient.api.members[":id"].$get({ param: { id } });
  if (res.status === 401) return { status: "unauthorized" };
  if (res.status === 404) return { status: "not-found" };
  if (!res.ok) throw new Error(`Failed to load member ${id}: ${res.status}`);
  const { profile }: { profile: MemberProfile } = await res.json();
  return { status: "ok", profile };
});

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const loaded = await loadMember(id);
  if (loaded.status === "ok") return { title: loaded.profile.displayName ?? "Member" };
  if (loaded.status === "not-found") return { title: "Member not found" };
  // Unauthorized: the page redirects to /signin; fall back to the default title.
  return {};
}

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
  const loaded = await loadMember(id);
  if (loaded.status === "unauthorized") redirect("/signin");

  if (loaded.status === "not-found") {
    return (
      <main className="flex min-h-screen flex-col items-center gap-6 px-8 pb-8 pt-3">
        <PageHeader title="Member not found" fallback="/members" />
        <p className="text-muted-foreground">We couldn&apos;t find a member with that name or ID.</p>
      </main>
    );
  }

  const { profile } = loaded;
  const memberSince = new Date(profile.createdAt).getFullYear();
  const isOwnProfile = me.id === profile.id;

  return (
    <QueryProvider>
      <main className="flex min-h-screen flex-col items-center gap-6 px-8 pb-8 pt-3">
        <PageHeader
          title={profile.displayName ?? "Member"}
          subtitle={<p className="text-sm text-muted-foreground">Member since {memberSince}</p>}
          fallback="/members"
        />

        {isOwnProfile ? (
          // Square, the same footprint as the mini-map on others' profiles.
          <Avatar
            name={profile.displayName}
            url={profile.avatarUrl}
            sizes="304px"
            priority
            className="flex aspect-square w-full max-w-[19rem] items-center justify-center overflow-hidden rounded-sm bg-muted text-5xl font-semibold text-muted-foreground"
          />
        ) : (
          // Photo + mini-map as one unit: stacked on phones, side-by-side on
          // desktop as two equal squares (the photo matches the map's footprint
          // at every width). The relation control sits below the map.
          <div className="flex w-full max-w-2xl flex-col items-center gap-4 sm:flex-row sm:items-start sm:justify-center">
            <Avatar
              name={profile.displayName}
              url={profile.avatarUrl}
              sizes="304px"
              priority
              // Square, the exact size of the mini-map: same sizing as the map's
              // column (aspect-square w-full, capped at max-w-[19rem]).
              className="flex aspect-square w-full max-w-[19rem] items-center justify-center overflow-hidden rounded-sm bg-muted text-5xl font-semibold text-muted-foreground sm:flex-1"
            />
            {/* Column capped narrow so the mini-map reads as a header accent, not its focus. */}
            <div className="flex w-full max-w-[19rem] flex-col gap-3 sm:flex-1">
              <ProfileMiniMap profileId={profile.id} memberName={profile.displayName} />
              <MemberRelationControl memberId={profile.id} memberName={profile.displayName} />
            </div>
          </div>
        )}

        <dl className="flex w-full max-w-md flex-col gap-4">
          <Field label="Bio">{profile.bio}</Field>
          <Field label="Keywords">{profile.keywords.length > 0 ? profile.keywords.join(", ") : null}</Field>
          <Field label="Location">{profile.location}</Field>
          {profile.currentIntention && (
            <Field label="Current intention">
              <span>{profile.currentIntention}</span>
              {profile.intentionUpdatedAt && (
                <span className="ml-2 text-xs text-muted-foreground">
                  {new Date(profile.intentionUpdatedAt).toLocaleDateString(undefined, {
                    month: "long",
                    year: "numeric",
                  })}
                </span>
              )}
            </Field>
          )}
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
