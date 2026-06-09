import { requireUser } from "@/lib/api-server";
import type { Me } from "@/lib/api-types";

import { WelcomeTabs } from "./welcome-tabs";

// Step 2 of the welcome flow: fill in or review profile data, then meet
// the Settings tab (one-step tour) before continuing. Saving the form
// stamps lastUpdatedProfile via PUT /me; the Continue button advances.
export default async function WelcomeProfilePage() {
  const me: Me = await requireUser();

  return (
    <>
      <div className="flex flex-col items-center gap-3 text-center">
        <h1 className="text-4xl font-bold">Your profile</h1>
        <p className="max-w-md text-base text-muted-foreground">Tell us a little about yourself.</p>
      </div>
      <WelcomeTabs profile={me.profile} />
    </>
  );
}
