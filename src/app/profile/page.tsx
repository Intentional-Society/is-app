import Link from "next/link";

import { Avatar } from "@/components/avatar";
import { BreadcrumbLink } from "@/components/breadcrumb-link";
import { KeywordChips } from "@/components/keyword-chips";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/api-server";
import type { Me } from "@/lib/api-types";

function Field({ label, children, badge }: { label: string; children: React.ReactNode; badge?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="flex items-center gap-2 text-sm uppercase tracking-wide text-muted-foreground">
        {label}
        {badge && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs normal-case tracking-normal text-muted-foreground">
            {badge}
          </span>
        )}
      </dt>
      <dd className="font-serif text-base">{children || <span className="text-muted-foreground">—</span>}</dd>
    </div>
  );
}

export default async function ProfilePage() {
  const me: Me = await requireUser();
  // /api/me self-heals a missing profile row, so this is effectively
  // unreachable — the guard keeps the type honest and fails loudly if
  // that invariant ever breaks.
  if (!me.profile) throw new Error("authenticated user has no profile");
  const profile = me.profile;

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 p-8">
      <div className="flex w-full max-w-md items-center justify-between">
        <h1 className="text-2xl font-bold">My profile</h1>
        <BreadcrumbLink fallback="/" />
      </div>

      {/* Square, the same footprint as the photos on member profiles. */}
      <Avatar
        name={profile.displayName}
        url={profile.avatarUrl}
        sizes="304px"
        priority
        className="flex aspect-square w-full max-w-[19rem] items-center justify-center overflow-hidden rounded-sm bg-muted text-5xl font-semibold text-muted-foreground"
      />

      <dl className="flex w-full max-w-md flex-col gap-4">
        <Field label="Display name">{profile.displayName}</Field>
        <Field label="Bio">{profile.bio}</Field>
        <Field label="Keywords">
          <KeywordChips keywords={profile.keywords} max={20} className="flex flex-wrap gap-1" />
        </Field>
        <Field label="Location">{profile.location}</Field>
        <Field label="Supplementary info">{profile.supplementaryInfo}</Field>
        <Field label="Emergency contact" badge="Only visible to you and admins">
          {profile.emergencyContact}
        </Field>
      </dl>

      <Button render={<Link href="/profile/edit" />}>Edit profile</Button>
    </main>
  );
}
