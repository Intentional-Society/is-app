import Link from "next/link";

import { requireUser } from "@/lib/api-server";
import type { Me } from "@/lib/api-types";

import { ProfileForm } from "../profile-form";

export default async function EditProfilePage() {
  const me: Me = await requireUser();
  const profile = me.profile!;

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
