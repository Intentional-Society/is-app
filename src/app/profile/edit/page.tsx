import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getProfileForSelf } from "@/server/profiles";

import { ProfileForm } from "../profile-form";

export default async function EditProfilePage() {
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
        <h1 className="text-2xl font-bold">Edit profile</h1>
        <Link href="/profile" className="text-base text-muted-foreground hover:text-foreground">
          ← Back to profile
        </Link>
      </div>

      <ProfileForm
        initial={{
          displayName: profile.displayName ?? "",
          bio: profile.bio ?? "",
          keywords: profile.keywords ?? [],
          location: profile.location ?? "",
          supplementaryInfo: profile.supplementaryInfo ?? "",
          avatarUrl: profile.avatarUrl ?? "",
          emergencyContact: profile.emergencyContact ?? "",
          liveDesire: profile.liveDesire ?? "",
        }}
      />
    </main>
  );
}
