import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getProfileForSelf } from "@/server/profiles";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs uppercase tracking-wide text-gray-400">{label}</dt>
      <dd className="font-serif text-sm">{children || <span className="text-gray-500">—</span>}</dd>
    </div>
  );
}

export default async function ProfilePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const profile = await getProfileForSelf(user.id);
  if (!profile) redirect("/login");

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 p-8">
      <div className="flex w-full max-w-md items-center justify-between">
        <h1 className="text-2xl font-bold">My profile</h1>
        <Link href="/" className="text-sm text-gray-400 hover:text-gray-500">
          ← Back
        </Link>
      </div>

      <dl className="flex w-full max-w-md flex-col gap-4">
        <Field label="Display name">{profile.displayName}</Field>
        <Field label="Bio">{profile.bio}</Field>
        <Field label="Keywords">
          {profile.keywords.length > 0
            ? profile.keywords.join(", ")
            : null}
        </Field>
        <Field label="Location">{profile.location}</Field>
        <Field label="Live desire">{profile.liveDesire}</Field>
        <Field label="Supplementary info">{profile.supplementaryInfo}</Field>
        <Field label="Avatar URL">{profile.avatarUrl}</Field>
        <Field label="Emergency contact">{profile.emergencyContact}</Field>
      </dl>

      <Link
        href="/profile/edit"
        className="rounded bg-gray-100 px-4 py-2 text-sm font-medium text-gray-900 hover:bg-gray-500"
      >
        Edit profile
      </Link>
    </main>
  );
}
