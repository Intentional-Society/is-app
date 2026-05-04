import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getProfileForMember } from "@/server/profiles";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-sm uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="font-serif text-base">{children || <span className="text-muted-foreground">—</span>}</dd>
    </div>
  );
}

export default async function MemberProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/signin");

  const { id } = await params;
  const profile = await getProfileForMember(id);
  if (!profile) notFound();

  const memberSince = profile.createdAt.getFullYear();

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 p-8">
      <div className="flex w-full max-w-md items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">
            {profile.displayName ?? "Member"}
          </h1>
          <p className="text-sm text-muted-foreground">Member since {memberSince}</p>
        </div>
        <Link href="/" className="text-base text-muted-foreground hover:text-foreground">
          ← Back
        </Link>
      </div>

      <dl className="flex w-full max-w-md flex-col gap-4">
        <Field label="Bio">{profile.bio}</Field>
        <Field label="Keywords">
          {profile.keywords.length > 0 ? profile.keywords.join(", ") : null}
        </Field>
        <Field label="Location">{profile.location}</Field>
        <Field label="Live desire">{profile.liveDesire}</Field>
        <Field label="Supplementary info">{profile.supplementaryInfo}</Field>
      </dl>
    </main>
  );
}
