import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getProfileForSelf, upsertProfile } from "@/server/profiles";

import { WelcomeForm } from "./welcome-form";

export default async function WelcomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  let profile = await getProfileForSelf(user.id);
  if (!profile) {
    await upsertProfile(user);
    profile = await getProfileForSelf(user.id);
  }

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 p-8">
      <h1 className="text-4xl font-bold">Welcome</h1>
      <p className="max-w-md text-center text-sm text-gray-400">
        Tell us a little about yourself. You can edit this later.
      </p>
      <WelcomeForm
        initial={{
          bio: profile?.bio ?? "",
          keywords: profile?.keywords ?? [],
          location: profile?.location ?? "",
          supplementaryInfo: profile?.supplementaryInfo ?? "",
          avatarUrl: profile?.avatarUrl ?? "",
          emergencyContact: profile?.emergencyContact ?? "",
          liveDesire: profile?.liveDesire ?? "",
        }}
      />
    </main>
  );
}
