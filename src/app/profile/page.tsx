import Link from "next/link";

import { Avatar } from "@/components/avatar";
import { KeywordChips } from "@/components/keyword-chips";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/api-server";
import type { Me } from "@/lib/api-types";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-sm uppercase tracking-wide text-muted-foreground">{label}</dt>
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
        <Link href="/" className="text-base text-muted-foreground hover:text-foreground">
          ← Back
        </Link>
      </div>

      <Avatar
        name={profile.displayName}
        url={profile.avatarUrl}
        sizes="128px"
        priority
        className="flex h-32 w-32 items-center justify-center overflow-hidden rounded-full bg-muted text-3xl font-semibold text-muted-foreground"
      />

      <dl className="flex w-full max-w-md flex-col gap-4">
        <Field label="Display name">{profile.displayName}</Field>
        <Field label="Bio">{profile.bio}</Field>
        <Field label="Keywords">
          <KeywordChips keywords={profile.keywords} max={20} className="flex flex-wrap gap-1" />
        </Field>
        <Field label="Location">{profile.location}</Field>
        <Field label="Live desire">{profile.liveDesire}</Field>
        <Field label="Supplementary info">{profile.supplementaryInfo}</Field>
        <Field label="Emergency contact">{profile.emergencyContact}</Field>
      </dl>

      <Button render={<Link href="/profile/edit" />}>Edit profile</Button>
    </main>
  );
}
