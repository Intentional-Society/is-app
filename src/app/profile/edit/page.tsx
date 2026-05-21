import Link from "next/link";

import { requireUser } from "@/lib/api-server";
import type { Me } from "@/lib/api-types";

import { AvatarUploader } from "../avatar-uploader";
import { ChangePasswordForm } from "../change-password-form";
import { ProfileForm } from "../profile-form";

export default async function EditProfilePage() {
  const me: Me = await requireUser();
  // /api/me self-heals a missing profile row, so this is effectively
  // unreachable — the guard keeps the type honest and fails loudly if
  // that invariant ever breaks.
  if (!me.profile) throw new Error("authenticated user has no profile");
  const profile = me.profile;

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 p-8">
      <div className="flex w-full max-w-md items-center justify-between">
        <h1 className="text-2xl font-bold">Edit profile</h1>
        <Link href="/profile" className="text-base text-muted-foreground hover:text-foreground">
          ← Back to profile
        </Link>
      </div>

      <AvatarUploader name={profile.displayName} initialUrl={profile.avatarUrl} />

      <ProfileForm
        initial={{
          displayName: profile.displayName ?? "",
          bio: profile.bio ?? "",
          keywords: profile.keywords ?? [],
          location: profile.location ?? "",
          supplementaryInfo: profile.supplementaryInfo ?? "",
          emergencyContact: profile.emergencyContact ?? "",
          liveDesire: profile.liveDesire ?? "",
          currentIntention: profile.currentIntention ?? "",
        }}
      />

      <div className="flex w-full max-w-md flex-col gap-3 border-t border-border pt-6">
        <h2 className="text-base font-semibold">Set or change password</h2>
        <p className="text-sm text-muted-foreground">
          If you prefer signing in via email, you don't need a password.
        </p>
        <ChangePasswordForm />
      </div>
    </main>
  );
}
