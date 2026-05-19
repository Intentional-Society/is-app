import { requireUser } from "@/lib/api-server";
import type { Me } from "@/lib/api-types";

import { AvatarUploader } from "../../profile/avatar-uploader";
import { WelcomeForm } from "./welcome-form";

// Step 2 of the welcome flow: fill in or review profile data. Saving the
// form stamps lastUpdatedProfile via PUT /me and advances.
export default async function WelcomeProfilePage() {
  const me: Me = await requireUser();
  const profile = me.profile;

  return (
    <>
      <div className="flex flex-col items-center gap-3 text-center">
        <h1 className="text-4xl font-bold">Your profile</h1>
        <p className="max-w-md text-base text-muted-foreground">Tell us a little about yourself.</p>
      </div>
      <AvatarUploader name={profile?.displayName ?? null} initialUrl={profile?.avatarUrl ?? null} />
      <WelcomeForm
        initial={{
          displayName: profile?.displayName ?? "",
          bio: profile?.bio ?? "",
          keywords: profile?.keywords ?? [],
          location: profile?.location ?? "",
          supplementaryInfo: profile?.supplementaryInfo ?? "",
          emergencyContact: profile?.emergencyContact ?? "",
          liveDesire: profile?.liveDesire ?? "",
        }}
      />
    </>
  );
}
