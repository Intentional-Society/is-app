import { requireUser } from "@/lib/api-server";
import type { Me } from "@/lib/api-types";

import { WelcomeForm } from "./welcome-form";

export default async function WelcomePage() {
  const me: Me = await requireUser();
  const profile = me.profile;

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 p-8">
      <h1 className="text-4xl font-bold">Welcome</h1>
      <p className="max-w-md text-center text-base text-muted-foreground">
        Tell us a little about yourself. You can edit this later.
      </p>
      <WelcomeForm
        initial={{
          displayName: profile?.displayName ?? "",
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
