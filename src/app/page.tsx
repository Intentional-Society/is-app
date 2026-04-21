import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getProfileForSelf, upsertProfile } from "@/server/profiles";

import { InvitesPanel } from "./invites-panel";
import { MeSmokeWidget } from "./me-smoke";

async function signOut() {
  "use server";
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  let profile = await getProfileForSelf(user.id);
  if (!profile) {
    // Self-heal in case 1d's callback upsert failed.
    await upsertProfile(user);
    profile = await getProfileForSelf(user.id);
  }

  // Incomplete-profile heuristic: bio null means the member has not
  // completed /welcome yet. bio is the one field the welcome form
  // always collects, so it's a reliable sentinel.
  if (profile && profile.bio === null) {
    redirect("/welcome");
  }

  return (
    <main className="flex min-h-screen flex-col items-center gap-6 p-8">
      <h1 className="text-4xl font-bold">Intentional Society</h1>
      <p className="text-sm">Signed in as {user.email}</p>
      <p className="text-sm">Display name: {profile?.displayName ?? "—"}</p>
      <form action={signOut}>
        <button
          type="submit"
          className="rounded border border-gray-600 px-3 py-2 text-sm"
        >
          Sign out
        </button>
      </form>
      <InvitesPanel />
      <MeSmokeWidget />
    </main>
  );
}
