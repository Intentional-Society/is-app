import Link from "next/link";

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
  const profile = me.profile!;

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 p-8">
      <div className="flex w-full max-w-md items-center justify-between">
        <h1 className="text-2xl font-bold">My profile</h1>
        <Link href="/" className="text-base text-muted-foreground hover:text-foreground">
          ← Back
        </Link>
      </div>

      <dl className="flex w-full max-w-md flex-col gap-4">
        <Field label="Display name">{profile.displayName}</Field>
        <Field label="Bio">{profile.bio}</Field>
        <Field label="Keywords">{profile.keywords.length > 0 ? profile.keywords.join(", ") : null}</Field>
        <Field label="Location">{profile.location}</Field>
        <Field label="Live desire">{profile.liveDesire}</Field>
        <Field label="Supplementary info">{profile.supplementaryInfo}</Field>
        <Field label="Avatar URL">{profile.avatarUrl}</Field>
        <Field label="Emergency contact">{profile.emergencyContact}</Field>
      </dl>

      <Button render={<Link href="/profile/edit" />}>Edit profile</Button>
    </main>
  );
}
